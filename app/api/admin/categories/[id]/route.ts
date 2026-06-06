import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase C · enforce 叠加
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor, hasPermission } from "@/lib/permission-actor";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // Phase C HC2 · read 走 env-gated hasPermission（id 反查 tenant_categories 仍是 read 语义）
  if (isResourceEnforced("category") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const ok = await hasPermission(actor, "category.read.all");
    if (!ok) return apiError("权限不足", "FORBIDDEN");
  }

  const { id } = await params;
  const { data } = await db.from("tenant_categories").select("tenant_code").eq("category_id", id);
  return NextResponse.json({ tenant_codes: (data ?? []).map((r) => r.tenant_code) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 先 load row 用于 v2 判定 + 404
  const { data: catRow } = await db.from("categories").select("id, name").eq("id", id).maybeSingle();
  if (!catRow) return apiError("分类不存在", "NOT_FOUND");

  // Phase C · v2 第二闸 update（platform-level → row 仅传 id 让 adapter checkWrite 走 .all key）
  if (isResourceEnforced("category")) {
    const actor = await buildPermissionActor(admin);
    const accessErr = await requireAccess(actor, "category", "update", {
      row: { id },
    });
    if (accessErr) return accessErr;
  }

  const body = await req.json();

  // 组织分配
  if (body.tenantCodes !== undefined) {
    const cat = catRow as { name: string };
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
