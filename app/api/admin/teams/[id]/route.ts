import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
// 6.4up v2 Phase D · D-4 · team enforce（env "team" 启用时生效；空时完全 no-op）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor } from "@/lib/permission-actor";

// 5.7up · 工具：org_admin 只能操作自己组织的小组
async function ensureOrgScope(
  admin: { role: string; tenantCode?: string | null },
  teamId: string
): Promise<Response | null> {
  if (admin.role !== "org_admin") return null;
  const { data: row } = await db.from("teams").select("tenant_code").eq("id", teamId).maybeSingle();
  if (!row) return apiError("小组不存在", "NOT_FOUND");
  if (!admin.tenantCode || row.tenant_code !== admin.tenantCode) {
    return apiError("无权操作该小组", "FORBIDDEN");
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

  // Phase D D-4 · v2 第二闸（env-gated；team.update）
  if (isResourceEnforced("team") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "team", "update", { id });
    if (err) return err;
  }

  const { name, sortOrder } = await req.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { data, error } = await db.from("teams").update(updates).eq("id", id).select().single();
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "team", resourceId: id, resourceName: data.name,
  });
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

  // Phase D D-4 · v2 第二闸（env-gated；team.delete）
  if (isResourceEnforced("team") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "team", "delete", { id });
    if (err) return err;
  }

  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("team_id", id);
  if (count && count > 0) {
    return apiError(`该小组下还有 ${count} 名用户，请先移除用户再删除`, "CONFLICT");
  }

  const { data: team } = await db.from("teams").select("name").eq("id", id).maybeSingle();
  // 5.11up · 删除前缓存 tenant 归属
  const resourceTenantCode = await resolveResourceTenantCode("team", id);
  await db.from("teams").delete().eq("id", id);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode,
    action: "delete", resourceType: "team", resourceId: id, resourceName: team?.name,
  });
  return NextResponse.json({ ok: true });
}
