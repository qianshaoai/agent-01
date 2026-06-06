import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase C · enforce 叠加（env "notice" 启用时生效；空时完全 no-op）
// R1：notice 的 POST 因业务转换（org_admin 强制 / 全局-vs-组织）不走 facade，直接 hasPermission
import { isResourceEnforced } from "@/lib/access-facade";
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

  const { tenantCode, content } = await req.json();
  if (!content?.trim()) {
    return apiError("公告内容不能为空", "VALIDATION_ERROR");
  }

  // 业务转换：org_admin 强制只能发自己组织的公告，禁止全局公告
  // 必须在 v2 enforce 之前算 finalTenantCode（v2 判定要按"最终归属"而非请求体）
  let finalTenantCode = tenantCode?.trim().toUpperCase() || null;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("你没有关联组织", "FORBIDDEN");
    finalTenantCode = admin.tenantCode;
  }

  // Phase C R1 · v2 第二闸 create（env-gated；按 finalTenantCode 双形态分支）
  //   _generic.buildTenantOwnedAdapter.checkCreate 只允许 actor.tenantCode 存在时走 .org scope，
  //   会把 "system_admin 创建全局公告（finalTenantCode=null）" 误拒。
  //   notice 的 create 路径走 route 层直接 hasPermission，与 HC2 list 模式一致：
  //     finalTenantCode === null → notice.create.all
  //     finalTenantCode != null  → notice.create.org + org scope = finalTenantCode
  if (isResourceEnforced("notice") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const ok = finalTenantCode === null
      ? await hasPermission(actor, "notice.create.all")
      : await hasPermission(actor, "notice.create.org", [
          { scope_type: "org", scope_id: finalTenantCode },
        ]);
    if (!ok) return apiError("权限不足", "FORBIDDEN");
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
