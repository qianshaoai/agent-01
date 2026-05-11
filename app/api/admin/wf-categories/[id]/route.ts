import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const { name } = await req.json();
  if (!name?.trim()) return apiError("分类名称不能为空", "VALIDATION_ERROR");

  const { data, error } = await db
    .from("wf_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "wf_category", resourceId: id, resourceName: data.name,
  });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 检查是否有工作流使用此分类
  const { count } = await db
    .from("workflow_categories")
    .select("*", { count: "exact", head: true })
    .eq("category_id", id);

  if ((count ?? 0) > 0) {
    return apiError(`该分类下还有 ${count} 个工作流，请先移除后再删除`, "CONFLICT");
  }

  const { data: cat } = await db.from("wf_categories").select("name").eq("id", id).maybeSingle();
  const { error } = await db.from("wf_categories").delete().eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "delete", resourceType: "wf_category", resourceId: id, resourceName: cat?.name,
  });
  return NextResponse.json({ ok: true });
}
