/**
 * 6.4up v2 Phase A · admin_permission_overrides · 单个 admin 视角
 *
 *   GET    /api/admin/admin-overrides/[adminId]?source=admin_table|user_admin
 *      返回该 admin 的所有 override
 *
 *   DELETE /api/admin/admin-overrides/[adminId]?source=...&key=...
 *      删除一条具体 override（permissionKey 必填）；不传 key 则一次清空该 admin 全部 override
 *
 * 权限：仅 super_admin
 */

import { NextResponse, NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function requireSuper(role: string): Response | null {
  if (role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");
  return null;
}

function parseSource(req: NextRequest): "admin_table" | "user_admin" | null {
  const s = req.nextUrl.searchParams.get("source");
  if (s === "admin_table" || s === "user_admin") return s;
  return null;
}

// ─── GET · 单 admin 的 overrides ──────────────────────────────────

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ adminId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { adminId } = await ctx.params;
  const source = parseSource(req);
  if (!source) return apiError("source 必须是 admin_table 或 user_admin", "VALIDATION_ERROR");

  const { data, error } = await db
    .from("admin_permission_overrides")
    .select("permission_key, effect, reason, created_by, created_at")
    .eq("admin_source", source)
    .eq("admin_id", adminId)
    .order("permission_key", { ascending: true });
  if (error) return dbError(error);

  return NextResponse.json({ data: data ?? [] });
}

// ─── DELETE · 单条 / 清空 ─────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ adminId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { adminId } = await ctx.params;
  const source = parseSource(req);
  if (!source) return apiError("source 必须是 admin_table 或 user_admin", "VALIDATION_ERROR");
  const key = req.nextUrl.searchParams.get("key");

  // 先 count（同条件），再 delete；supabase JS delete 不支持单查询返 count
  let countQuery = db
    .from("admin_permission_overrides")
    .select("permission_key", { count: "exact", head: true })
    .eq("admin_source", source)
    .eq("admin_id", adminId);
  if (key) countQuery = countQuery.eq("permission_key", key);
  const { count: deletedCount, error: countErr } = await countQuery;
  if (countErr) return dbError(countErr);

  let delQuery = db
    .from("admin_permission_overrides")
    .delete()
    .eq("admin_source", source)
    .eq("admin_id", adminId);
  if (key) delQuery = delQuery.eq("permission_key", key);
  const { error: delErr } = await delQuery;
  if (delErr) return dbError(delErr);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "delete",
    resourceType: "admin_override",
    resourceId: adminId,
    resourceName: `${source}:${adminId}`,
    detail: { permissionKey: key, deletedCount: deletedCount ?? 0 },
  });

  return NextResponse.json({ ok: true, deletedCount: deletedCount ?? 0 });
}
