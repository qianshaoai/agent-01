/**
 * 6.4up v2 Phase B B.3 · 角色默认包 GET / PUT（Tab 2 用）
 *
 * 权限：仅 super_admin（C1 约束）
 * role 入参 严校：仅 'system_admin' / 'org_admin'（C1 约束；super_admin / user / 任意值都 400）
 *
 * GET：拉 builtin_role_permissions[role] + 同时返算好的 beforeHash / affectedCount，
 *      减少前端"发请求 → 算 hash → 再 PUT"的额外 round-trip 风险
 * PUT：差量写 + 双护栏 + 读后校验（C2 + C3 约束）
 *   1. 解析 body { permissionKeys, confirmAffectedCount, confirmBeforeHash }
 *   2. 读 before keys（SELECT WHERE role=:role）
 *   3. 双护栏 412：confirmBeforeHash / confirmAffectedCount 任一不匹配
 *   4. 算 diff（toAdd / toRemove）
 *   5. UPSERT toAdd（onConflict 跳过）
 *   6. DELETE toRemove
 *   7. 再 SELECT 读后校验：与期望集 strict equal
 *   8. 校验失败 → 不写 audit，500
 *   9. 校验通过 → 写 audit（detail 含 before/after/added/removed）
 */

import { NextResponse, NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import { isAdminPermissionKey } from "@/lib/permission-keys";

export const dynamic = "force-dynamic";

type EditableRole = "system_admin" | "org_admin";

function parseRole(value: string): EditableRole | null {
  if (value === "system_admin" || value === "org_admin") return value;
  return null;
}

function hashKeys(keys: string[]): string {
  const sorted = [...keys].sort();
  return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}

async function countAffectedAdmins(role: EditableRole): Promise<number> {
  // admins 表 + users 表 WHERE role=:role AND status='active'
  const [a, u] = await Promise.all([
    db.from("admins").select("id", { count: "exact", head: true }).eq("role", role),
    db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", role)
      .eq("status", "active"),
  ]);
  // 查询失败保守返 -1（PUT 时会与前端值不等触发 412）
  if (a.error || u.error) return -1;
  return (a.count ?? 0) + (u.count ?? 0);
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ role: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可访问", "FORBIDDEN");
  }

  const { role: roleParam } = await ctx.params;
  const role = parseRole(roleParam);
  if (!role) {
    return apiError(
      "role 必须是 'system_admin' 或 'org_admin'（super_admin 硬全权不入此表）",
      "VALIDATION_ERROR",
    );
  }

  const [packRes, affectedCount] = await Promise.all([
    db
      .from("builtin_role_permissions")
      .select("permission_key")
      .eq("role", role)
      .order("permission_key", { ascending: true }),
    countAffectedAdmins(role),
  ]);
  if (packRes.error) return dbError(packRes.error);

  const permissionKeys = ((packRes.data ?? []) as { permission_key: string }[])
    .map((r) => r.permission_key)
    .sort();

  return NextResponse.json({
    role,
    permissionKeys,
    beforeHash: hashKeys(permissionKeys),
    affectedCount,
  });
}

// ── PUT ──────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ role: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可访问", "FORBIDDEN");
  }

  const { role: roleParam } = await ctx.params;
  const role = parseRole(roleParam);
  if (!role) {
    return apiError(
      "role 必须是 'system_admin' 或 'org_admin'",
      "VALIDATION_ERROR",
    );
  }

  let body: {
    permissionKeys?: unknown;
    confirmAffectedCount?: unknown;
    confirmBeforeHash?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return apiError("请求体不是合法 JSON", "VALIDATION_ERROR");
  }

  const { permissionKeys, confirmAffectedCount, confirmBeforeHash } = body;

  // ── 校验入参 ─────────────────────────────────────────────────
  if (!Array.isArray(permissionKeys)) {
    return apiError("permissionKeys 必须是数组", "VALIDATION_ERROR");
  }
  const target: string[] = [];
  for (const k of permissionKeys) {
    if (typeof k !== "string" || !isAdminPermissionKey(k)) {
      return apiError(`permissionKey ${String(k)} 不在 ADMIN_PERMISSION_KEYS 合法清单中`, "VALIDATION_ERROR");
    }
    // 业务约束：setting.* / permission.* 不允许入默认包（与 admin-overrides POST 同口径）
    const prefix = k.split(".")[0];
    if (prefix === "setting" || prefix === "permission") {
      return apiError("setting / permission 前缀不允许入角色默认包（仅 super 硬全权）", "FORBIDDEN");
    }
    target.push(k);
  }
  // dedup（防止前端送重复）
  const targetSet = new Set(target);
  const targetSorted = [...targetSet].sort();

  if (typeof confirmAffectedCount !== "number" || !Number.isFinite(confirmAffectedCount) || confirmAffectedCount < 0) {
    return apiError("confirmAffectedCount 必须是非负整数", "VALIDATION_ERROR");
  }
  if (typeof confirmBeforeHash !== "string" || confirmBeforeHash.length !== 64) {
    return apiError("confirmBeforeHash 必须是 64 位 sha256 hex", "VALIDATION_ERROR");
  }

  // ── 1. 读 before keys ─────────────────────────────────────────
  const { data: beforeRows, error: beforeErr } = await db
    .from("builtin_role_permissions")
    .select("permission_key")
    .eq("role", role);
  if (beforeErr) return dbError(beforeErr);

  const beforeKeys = ((beforeRows ?? []) as { permission_key: string }[])
    .map((r) => r.permission_key)
    .sort();
  const beforeHash = hashKeys(beforeKeys);

  // ── 2. 双护栏 ─────────────────────────────────────────────────
  if (beforeHash !== confirmBeforeHash) {
    return apiError(
      "角色默认包在你打开页面后已被其它管理员改动，请刷新重试",
      "PRECONDITION_FAILED",
    );
  }
  const actualCount = await countAffectedAdmins(role);
  if (actualCount !== confirmAffectedCount) {
    return apiError(
      `受影响管理员数变化（页面：${confirmAffectedCount}，当前：${actualCount}），请刷新重试`,
      "PRECONDITION_FAILED",
    );
  }

  // ── 3. 算 diff ────────────────────────────────────────────────
  const beforeSet = new Set(beforeKeys);
  const toAdd = targetSorted.filter((k) => !beforeSet.has(k));
  const toRemove = beforeKeys.filter((k) => !targetSet.has(k));

  // 没差异：早退（不写 audit；前端可由"added=0, removed=0"提示"无变化"）
  if (toAdd.length === 0 && toRemove.length === 0) {
    return NextResponse.json({
      ok: true,
      added: 0,
      removed: 0,
      afterHash: beforeHash,
      note: "无变化",
    });
  }

  // ── 4. UPSERT 新增 ────────────────────────────────────────────
  if (toAdd.length > 0) {
    const { error: insErr } = await db
      .from("builtin_role_permissions")
      .upsert(
        toAdd.map((k) => ({
          role,
          permission_key: k,
          updated_by: admin.adminId,
        })),
        { onConflict: "role,permission_key" },
      );
    if (insErr) return dbError(insErr);
  }

  // ── 5. DELETE 移除 ───────────────────────────────────────────
  if (toRemove.length > 0) {
    const { error: delErr } = await db
      .from("builtin_role_permissions")
      .delete()
      .eq("role", role)
      .in("permission_key", toRemove);
    if (delErr) return dbError(delErr);
  }

  // ── 6. 读后校验（C2 约束） ────────────────────────────────────
  const { data: afterRows, error: afterErr } = await db
    .from("builtin_role_permissions")
    .select("permission_key")
    .eq("role", role);
  if (afterErr) return dbError(afterErr);
  const afterKeys = ((afterRows ?? []) as { permission_key: string }[])
    .map((r) => r.permission_key)
    .sort();
  const afterHash = hashKeys(afterKeys);

  // 期望集合 = targetSorted
  const expected = targetSorted;
  let ok = afterKeys.length === expected.length;
  if (ok) {
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== afterKeys[i]) {
        ok = false;
        break;
      }
    }
  }
  if (!ok) {
    // 校验失败 → 不写 audit，返 500（C2 约束）
    console.error("[role-permissions PUT] 写后校验失败", {
      role,
      expected,
      afterKeys,
      added: toAdd,
      removed: toRemove,
    });
    return apiError(
      "写后状态与期望不一致，请刷新重试。如反复出现请联系运维。",
      "INTERNAL_ERROR",
    );
  }

  // ── 7. 写 audit ───────────────────────────────────────────────
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "builtin_role_permission",
    resourceId: role,
    resourceName: `default-pack:${role}`,
    detail: {
      before: beforeKeys,
      after: afterKeys,
      added: toAdd,
      removed: toRemove,
      affectedCount: actualCount,
    },
  });

  return NextResponse.json({
    ok: true,
    added: toAdd.length,
    removed: toRemove.length,
    afterHash,
  });
}
