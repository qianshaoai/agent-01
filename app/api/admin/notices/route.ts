import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase C · enforce 叠加（env "notice" 启用时生效；空时完全 no-op）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor, hasPermission } from "@/lib/permission-actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // Phase C HC2 · list 走 env-gated hasPermission 粗粒度 check（不走 requireAccess 因为没 row）
  // 任一 scope 通过即放行；旧 org_admin filter 继续叠加（保留全局公告可见性）
  if (isResourceEnforced("notice") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const okOrg = actor.tenantCode
      ? await hasPermission(actor, "notice.read.org", [
          { scope_type: "org", scope_id: actor.tenantCode },
        ])
      : false;
    const okAll = await hasPermission(actor, "notice.read.all");
    if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 50);
  let query = db
    .from("notices")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 组织管理员只能看自己组织的公告 + 全局公告
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return paginatedResponse([], 0, page, pageSize);
    query = query.or(`tenant_code.is.null,tenant_code.eq.${admin.tenantCode}`);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // Phase C · v2 第二闸 create（env-gated；空时 no-op）
  if (isResourceEnforced("notice")) {
    const actor = await buildPermissionActor(admin);
    const accessErr = await requireAccess(actor, "notice", "create");
    if (accessErr) return accessErr;
  }

  const { tenantCode, content } = await req.json();
  if (!content?.trim()) {
    return apiError("公告内容不能为空", "VALIDATION_ERROR");
  }

  // 组织管理员：强制只能发自己组织的公告，禁止全局公告
  let finalTenantCode = tenantCode?.trim().toUpperCase() || null;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("你没有关联组织", "FORBIDDEN");
    finalTenantCode = admin.tenantCode;
  }

  const { data, error } = await db
    .from("notices")
    .insert({
      tenant_code: finalTenantCode,
      content: content.trim(),
      enabled: true,
    })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "notice", resourceId: data.id,
    resourceName: data.content?.slice(0, 50),
    detail: { tenant_code: finalTenantCode },
  });
  return NextResponse.json(data, { status: 201 });
}
