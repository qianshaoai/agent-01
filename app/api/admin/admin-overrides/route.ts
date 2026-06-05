/**
 * 6.4up v2 Phase A · admin_permission_overrides 集合层 API
 *
 * 用途：
 *   - GET：列出所有 admin 的 override（按 (admin_source, admin_id, effect) 聚合）
 *   - POST：写入单条 override（grant 或 revoke），upsert 语义
 *
 * 权限：仅 super_admin
 * 写入校验：严格按 ADMIN_PERMISSION_KEYS（与 custom-roles 校验 WORKFLOW set 不同通道）
 *
 * 双通道隔离：
 *   - 本接口操作 builtin admin 的 v2 通道
 *   - custom-roles 接口操作 custom admin 的 v50 通道（workflow only）
 *   两通道写入校验互不交叉
 */

import { NextResponse, NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";
import {
  isAdminPermissionKey,
  AdminPermissionKey,
} from "@/lib/permission-keys";

export const dynamic = "force-dynamic";

function requireSuper(role: string): Response | null {
  if (role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");
  return null;
}

// ─── GET · 列出所有 admin override ───────────────────────────────

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { data, error } = await db
    .from("admin_permission_overrides")
    .select("admin_source, admin_id, permission_key, effect, reason, created_by, created_at")
    .order("created_at", { ascending: false });
  if (error) return dbError(error);

  return NextResponse.json({ data: data ?? [] });
}

// ─── POST · upsert 一条 override ─────────────────────────────────

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  let body: {
    adminId?: unknown;
    adminSource?: unknown;
    permissionKey?: unknown;
    effect?: unknown;
    reason?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return apiError("请求体不是合法 JSON", "VALIDATION_ERROR");
  }

  const { adminId, adminSource, permissionKey, effect, reason } = body;

  if (typeof adminId !== "string" || !adminId) {
    return apiError("adminId 必填", "VALIDATION_ERROR");
  }
  if (adminSource !== "admin_table" && adminSource !== "user_admin") {
    return apiError("adminSource 必须是 'admin_table' 或 'user_admin'", "VALIDATION_ERROR");
  }
  if (typeof permissionKey !== "string" || !isAdminPermissionKey(permissionKey)) {
    return apiError(`permissionKey ${String(permissionKey)} 不在 ADMIN_PERMISSION_KEYS 合法清单中`, "VALIDATION_ERROR");
  }
  if (effect !== "grant" && effect !== "revoke") {
    return apiError("effect 必须是 'grant' 或 'revoke'", "VALIDATION_ERROR");
  }
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return apiError("reason 必须是字符串", "VALIDATION_ERROR");
  }

  // 业务约束（方案验收 #7）：禁止 grant 给非 super 的 setting.* / permission.*
  //   即使 admin 是 super_admin 本人调用，也不允许给别人 grant 这两个前缀
  const prefix = permissionKey.split(".")[0];
  if (prefix === "setting" || prefix === "permission") {
    return apiError("setting / permission 前缀不允许 override（仅 super 硬全权）", "FORBIDDEN");
  }

  // upsert
  const { error: upErr } = await db
    .from("admin_permission_overrides")
    .upsert(
      {
        admin_id: adminId,
        admin_source: adminSource,
        permission_key: permissionKey as AdminPermissionKey,
        effect,
        reason: reason ?? null,
        created_by: admin.adminId,
      },
      { onConflict: "admin_source,admin_id,permission_key" },
    );
  if (upErr) return dbError(upErr);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "admin_override",
    resourceId: adminId,
    resourceName: `${adminSource}:${adminId}`,
    detail: { permissionKey, effect, reason: reason ?? null },
  });

  return NextResponse.json({ ok: true });
}
