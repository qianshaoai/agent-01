import { dbError, apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "tenant", "update", { id });
    if (err) return err;
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.quota !== undefined) {
    const q = Number(body.quota);
    if (isNaN(q) || !Number.isInteger(q) || q < 0 || q > 10_000_000) {
      return apiError("配额必须为 0~10,000,000 的整数", "VALIDATION_ERROR");
    }
    updates.quota = q;
  }
  if (body.expiresAt !== undefined) {
    const d = new Date(body.expiresAt);
    if (isNaN(d.getTime())) return apiError("到期日期格式不合法", "VALIDATION_ERROR");
    updates.expires_at = body.expiresAt;
  }
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const { data, error } = await db
    .from("tenants")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  const auditAction = body.enabled === true ? "enable" : body.enabled === false ? "disable" : "update";
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: auditAction,
    resourceType: "tenant",
    resourceId: id,
    resourceName: data.name,
  });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "tenant", "delete", { id });
    if (err) return err;
  }

  const { data: tenant } = await db.from("tenants").select("code, name").eq("id", id).single();
  if (!tenant) return apiError("组织不存在", "NOT_FOUND");

  const { count: activeUserCount } = await db
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("tenant_code", tenant.code)
    .in("status", ["active", "disabled"]);

  if ((activeUserCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `该组织下还有 ${activeUserCount} 名有效用户，请先删除或迁移用户后再删除组织` },
      { status: 409 },
    );
  }

  await db
    .from("users")
    .delete()
    .eq("tenant_code", tenant.code)
    .in("status", ["deleted", "cancelled"]);

  await db
    .from("resource_permissions")
    .delete()
    .eq("scope_type", "org")
    .eq("scope_id", tenant.code);

  const { error } = await db.from("tenants").delete().eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode: tenant.code,
    action: "delete",
    resourceType: "tenant",
    resourceId: id,
    resourceName: tenant.name,
  });
  return NextResponse.json({ ok: true });
}
