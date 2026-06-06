/**
 * 6.4up v2 Phase B B.2 · 单 admin effective set 聚合（Tab 1 详情用）
 *
 * 返回该 admin 的：
 *   - role
 *   - defaultPackKeys（来自 builtin_role_permissions[role]）
 *   - overrides（grant/revoke 列表）
 *   - effective（默认包 ∪ grant − revoke）
 *
 * 权限：仅 super_admin（C1 约束）
 * source 入参 强校：admin_table | user_admin
 *
 * super_admin 目标：直接返 role + 空 defaultPack（CHECK 限制，super 不入表）+ 空 overrides + effective='*'，
 *   UI 看到此返回直接显示"硬全权"提示，禁用编辑
 */

import { NextResponse, NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

type AdminSource = "admin_table" | "user_admin";

function parseSource(req: NextRequest): AdminSource | null {
  const s = req.nextUrl.searchParams.get("source");
  if (s === "admin_table" || s === "user_admin") return s;
  return null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ adminId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可访问", "FORBIDDEN");
  }

  const { adminId } = await ctx.params;
  const source = parseSource(req);
  if (!source) return apiError("source 必须是 admin_table 或 user_admin", "VALIDATION_ERROR");

  // ── 反查 target role + 校验存在性 ──────────────────────────────
  const table = source === "admin_table" ? "admins" : "users";
  const { data: targetRow, error: targetErr } = await db
    .from(table)
    .select("id, role")
    .eq("id", adminId)
    .maybeSingle();
  if (targetErr) return dbError(targetErr);
  if (!targetRow) return apiError("目标管理员不存在", "NOT_FOUND");

  const role = (targetRow as { role: string }).role;
  if (!["super_admin", "system_admin", "org_admin"].includes(role)) {
    return apiError("目标用户不是 builtin admin", "VALIDATION_ERROR");
  }

  // super_admin：硬全权，不入 v52 两表
  if (role === "super_admin") {
    return NextResponse.json({
      role,
      defaultPackKeys: [],
      overrides: [],
      effective: ["*"], // 哨兵：UI 看到立刻显示"硬全权"
      superAdmin: true,
    });
  }

  // ── 并行拉默认包 + overrides ────────────────────────────────────
  const [packRes, overridesRes] = await Promise.all([
    db.from("builtin_role_permissions").select("permission_key").eq("role", role),
    db
      .from("admin_permission_overrides")
      .select("permission_key, effect, reason, created_by, created_at")
      .eq("admin_source", source)
      .eq("admin_id", adminId)
      .order("permission_key", { ascending: true }),
  ]);
  if (packRes.error) return dbError(packRes.error);
  if (overridesRes.error) return dbError(overridesRes.error);

  const defaultPackKeys = ((packRes.data ?? []) as { permission_key: string }[])
    .map((r) => r.permission_key)
    .sort();

  type Ov = {
    permission_key: string;
    effect: "grant" | "revoke";
    reason: string | null;
    created_by: string;
    created_at: string;
  };
  const overrides = (overridesRes.data ?? []) as Ov[];

  // effective = 默认包 ∪ grant − revoke
  const effSet = new Set<string>(defaultPackKeys);
  for (const o of overrides) {
    if (o.effect === "grant") effSet.add(o.permission_key);
    else effSet.delete(o.permission_key);
  }
  const effective = [...effSet].sort();

  return NextResponse.json({
    role,
    defaultPackKeys,
    overrides,
    effective,
    superAdmin: false,
  });
}
