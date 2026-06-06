import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase D · D-4 · dept enforce（env "dept" 启用时生效；空时完全 no-op）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor, hasPermission } from "@/lib/permission-actor";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // Phase D D-4 · list 走 env-gated hasPermission 粗粒度 check（HC2）；org_admin tenant filter 下方保留
  if (isResourceEnforced("dept") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const okOrg = actor.tenantCode
      ? await hasPermission(actor, "dept.read.org", [
          { scope_type: "org", scope_id: actor.tenantCode },
        ])
      : false;
    const okAll = await hasPermission(actor, "dept.read.all");
    if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 100);
  let tenantCode = req.nextUrl.searchParams.get("tenantCode");
  // 5.7up · org_admin 强制只看本组织，忽略前端传的 tenantCode
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    tenantCode = admin.tenantCode;
  }

  let query = db.from("departments").select("*", { count: "exact" }).order("sort_order").order("created_at");
  if (tenantCode) query = query.eq("tenant_code", tenantCode);

  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) return dbError(error);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { tenantCode, name, sortOrder } = await req.json();
  if (!tenantCode || !name?.trim()) {
    return apiError("请填写组织码和部门名称", "VALIDATION_ERROR");
  }

  const targetTenant = String(tenantCode).toUpperCase();
  // 5.7up · org_admin 只能在自己组织建部门
  if (admin.role === "org_admin") {
    if (!admin.tenantCode || admin.tenantCode.toUpperCase() !== targetTenant) {
      return apiError("无权在该组织下创建部门", "FORBIDDEN");
    }
  }

  // Phase D D-4 · v2 第二闸 create（env-gated；generic checkCreate：.all 兜底 OR 自身 .org）
  if (isResourceEnforced("dept") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "dept", "create");
    if (err) return err;
  }

  const { data, error } = await db
    .from("departments")
    .insert({ tenant_code: targetTenant, name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "department", resourceId: data.id, resourceName: data.name,
    detail: { tenant_code: targetTenant },
  });
  return NextResponse.json(data, { status: 201 });
}
