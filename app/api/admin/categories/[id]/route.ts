import { dbError, apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "category", "read", { row: { id: "__tenant_categories__" } });
    if (err) return err;
  }

  const { id } = await params;
  const { data } = await db.from("tenant_categories").select("tenant_code").eq("category_id", id);
  return NextResponse.json({ tenant_codes: (data ?? []).map((r) => r.tenant_code) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const { data: catRow } = await db.from("categories").select("id, name").eq("id", id).maybeSingle();
  if (!catRow) return apiError("分类不存在", "NOT_FOUND");

  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "category", "update", { row: { id } });
    if (accessErr) return accessErr;
  }

  const body = await req.json();

  if (body.tenantCodes !== undefined) {
    const cat = catRow as { name: string };
    await db.from("tenant_categories").delete().eq("category_id", id);
    if (body.tenantCodes.length > 0) {
      await db.from("tenant_categories").insert(
        body.tenantCodes.map((code: string) => ({ tenant_code: code, category_id: id })),
      );
    }
    await writeAuditLog({
      adminId: ctx.adminId,
      adminUsername: ctx.username,
      adminRole: ctx.role,
      adminTenantCode: ctx.tenantCode ?? null,
      action: "update",
      resourceType: "category",
      resourceId: id,
      resourceName: cat?.name,
      detail: { tenantCodes: body.tenantCodes },
    });
    return NextResponse.json({ ok: true });
  }

  const { name } = body;
  if (!name?.trim()) return apiError("分类名称不能为空", "VALIDATION_ERROR");

  const { data, error } = await db
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "update",
    resourceType: "category",
    resourceId: id,
    resourceName: data.name,
  });
  return NextResponse.json(data);
}
