import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;
  const { data } = await db.from("tenant_categories").select("tenant_code").eq("category_id", id);
  return NextResponse.json({ tenant_codes: (data ?? []).map((r) => r.tenant_code) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const body = await req.json();

  // 组织分配
  if (body.tenantCodes !== undefined) {
    const { data: cat } = await db.from("categories").select("name").eq("id", id).maybeSingle();
    await db.from("tenant_categories").delete().eq("category_id", id);
    if (body.tenantCodes.length > 0) {
      await db.from("tenant_categories").insert(
        body.tenantCodes.map((code: string) => ({ tenant_code: code, category_id: id }))
      );
    }
    await writeAuditLog({
      adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
      action: "update", resourceType: "category", resourceId: id, resourceName: cat?.name,
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
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "category", resourceId: id, resourceName: data.name,
  });
  return NextResponse.json(data);
}
