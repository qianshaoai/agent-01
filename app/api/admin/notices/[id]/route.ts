import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
// 6.4up v2 Phase C · enforce 叠加
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor } from "@/lib/permission-actor";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 先 load row（v2 + 旧逻辑都要用）
  const { data: noticeRow } = await db
    .from("notices")
    .select("tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (!noticeRow) return apiError("公告不存在", "NOT_FOUND");

  // Phase C · v2 第二闸 update（env-gated；fail-closed）
  if (isResourceEnforced("notice")) {
    const actor = await buildPermissionActor(admin);
    const accessErr = await requireAccess(actor, "notice", "update", {
      row: { id, tenant_code: (noticeRow as { tenant_code: string | null }).tenant_code },
    });
    if (accessErr) return accessErr;
  }

  // 旧 org_admin 权限校验：只能操作自己组织的公告（保留作为 fail-fast）
  if (admin.role === "org_admin") {
    const tc = (noticeRow as { tenant_code: string | null }).tenant_code;
    if (!tc || tc !== admin.tenantCode) {
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
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
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

  // 先 load row
  const { data: noticeRow } = await db
    .from("notices")
    .select("tenant_code, content")
    .eq("id", id)
    .maybeSingle();
  if (!noticeRow) return apiError("公告不存在", "NOT_FOUND");

  // Phase C · v2 第二闸 delete（env-gated；fail-closed）
  if (isResourceEnforced("notice")) {
    const actor = await buildPermissionActor(admin);
    const accessErr = await requireAccess(actor, "notice", "delete", {
      row: { id, tenant_code: (noticeRow as { tenant_code: string | null }).tenant_code },
    });
    if (accessErr) return accessErr;
  }

  // 旧 org_admin 权限校验：只能删除自己组织的公告
  if (admin.role === "org_admin") {
    const tc = (noticeRow as { tenant_code: string | null }).tenant_code;
    if (!tc || tc !== admin.tenantCode) {
      return apiError("无权删除该公告", "FORBIDDEN");
    }
  }

  // 5.11up · 删除前缓存 tenant 归属
  const resourceTenantCode = await resolveResourceTenantCode("notice", id);
  await db.from("notices").delete().eq("id", id);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode,
    action: "delete", resourceType: "notice", resourceId: id,
    resourceName: ((noticeRow as { content: string | null }).content)?.slice(0, 50),
  });
  return NextResponse.json({ ok: true });
}
