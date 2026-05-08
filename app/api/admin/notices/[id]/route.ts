import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // org_admin 权限校验：只能操作自己组织的公告
  if (admin.role === "org_admin") {
    const { data: notice } = await db.from("notices").select("tenant_code").eq("id", id).single();
    if (!notice) return apiError("公告不存在", "NOT_FOUND");
    if (!notice.tenant_code || notice.tenant_code !== admin.tenantCode) {
      return apiError("无权修改该公告", "FORBIDDEN");
    }
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.content !== undefined) updates.content = body.content;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  // org_admin 不允许修改 tenantCode（防止改成全局公告）
  if (body.tenantCode !== undefined && admin.role !== "org_admin") {
    updates.tenant_code = body.tenantCode || null;
  }

  const { data, error } = await db
    .from("notices")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  const noticeAction = body.enabled === true ? "enable" : body.enabled === false ? "disable" : "update";
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: noticeAction, resourceType: "notice", resourceId: id,
    resourceName: (data.content as string)?.slice(0, 50),
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

  // org_admin 权限校验：只能删除自己组织的公告
  if (admin.role === "org_admin") {
    const { data: notice } = await db.from("notices").select("tenant_code").eq("id", id).single();
    if (!notice) return apiError("公告不存在", "NOT_FOUND");
    if (!notice.tenant_code || notice.tenant_code !== admin.tenantCode) {
      return apiError("无权删除该公告", "FORBIDDEN");
    }
  }

  const { data: noticeRow } = await db.from("notices").select("content").eq("id", id).maybeSingle();
  await db.from("notices").delete().eq("id", id);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: "delete", resourceType: "notice", resourceId: id,
    resourceName: (noticeRow?.content as string | undefined)?.slice(0, 50),
  });
  return NextResponse.json({ ok: true });
}
