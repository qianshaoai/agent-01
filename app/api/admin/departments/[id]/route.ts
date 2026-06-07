import { dbError, apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

async function ensureLegacyOrgScope(ctx: AdminActorContext, deptId: string): Promise<Response | null> {
  if (ctx.role !== "org_admin" || ctx.actor.v2Loaded) return null;
  const { data: row } = await db.from("departments").select("tenant_code").eq("id", deptId).maybeSingle();
  if (!row) return apiError("部门不存在", "NOT_FOUND");
  if (!ctx.tenantCode || row.tenant_code !== ctx.tenantCode) return apiError("无权操作该部门", "FORBIDDEN");
  return null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const guard = await ensureLegacyOrgScope(ctx, id);
  if (guard) return guard;

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "dept", "update", { id });
    if (err) return err;
  }

  const { name, sortOrder } = await req.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { data, error } = await db.from("departments").update(updates).eq("id", id).select().single();
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "update",
    resourceType: "department",
    resourceId: id,
    resourceName: data.name,
  });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const guard = await ensureLegacyOrgScope(ctx, id);
  if (guard) return guard;

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "dept", "delete", { id });
    if (err) return err;
  }

  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("dept_id", id);
  if (count && count > 0) {
    return apiError(`该部门下还有 ${count} 名用户，请先移除用户再删除`, "CONFLICT");
  }

  const { data: dept } = await db.from("departments").select("name").eq("id", id).maybeSingle();
  const resourceTenantCode = await resolveResourceTenantCode("department", id);
  await db.from("departments").delete().eq("id", id);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode,
    action: "delete",
    resourceType: "department",
    resourceId: id,
    resourceName: dept?.name,
  });
  return NextResponse.json({ ok: true });
}
