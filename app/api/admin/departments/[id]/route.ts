import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

// 5.7up · 工具：org_admin 只能操作自己组织的部门
async function ensureOrgScope(
  admin: { role: string; tenantCode?: string | null },
  deptId: string
): Promise<Response | null> {
  if (admin.role !== "org_admin") return null;
  const { data: row } = await db.from("departments").select("tenant_code").eq("id", deptId).maybeSingle();
  if (!row) return apiError("部门不存在", "NOT_FOUND");
  if (!admin.tenantCode || row.tenant_code !== admin.tenantCode) {
    return apiError("无权操作该部门", "FORBIDDEN");
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const guard = await ensureOrgScope(admin, id);
  if (guard) return guard;

  const { name, sortOrder } = await req.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { data, error } = await db.from("departments").update(updates).eq("id", id).select().single();
  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const guard = await ensureOrgScope(admin, id);
  if (guard) return guard;

  // 检查是否有用户归属此部门
  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("dept_id", id);
  if (count && count > 0) {
    return apiError(`该部门下还有 ${count} 名用户，请先移除用户再删除`, "CONFLICT");
  }

  await db.from("departments").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
