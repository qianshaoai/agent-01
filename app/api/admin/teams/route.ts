import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permission-actor";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const okAll = ctx.role === "super_admin" || await hasPermission(ctx.actor, "team.read.all");
  const okOrg = ctx.tenantCode
    ? await hasPermission(ctx.actor, "team.read.org", [{ scope_type: "org", scope_id: ctx.tenantCode }])
    : false;
  if (ctx.role !== "super_admin" && !okAll && !okOrg) return apiError("权限不足", "FORBIDDEN");

  const { page, pageSize, start } = parsePagination(req, 100);
  const deptId = req.nextUrl.searchParams.get("deptId");
  let tenantCode = req.nextUrl.searchParams.get("tenantCode");
  if (!okAll && ctx.tenantCode) tenantCode = ctx.tenantCode;

  let query = db.from("teams").select("*", { count: "exact" }).order("sort_order").order("created_at");
  if (deptId) query = query.eq("dept_id", deptId);
  if (tenantCode) query = query.eq("tenant_code", tenantCode);

  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) return dbError(error);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { deptId, tenantCode, name, sortOrder } = await req.json();
  if (!deptId || !tenantCode || !name?.trim()) {
    return apiError("请填写部门和小组名称", "VALIDATION_ERROR");
  }

  const targetTenant = String(tenantCode).toUpperCase();
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "team", "create");
    if (err) return err;
    const okAll = await hasPermission(ctx.actor, "team.create.all");
    if (!okAll && (!ctx.tenantCode || ctx.tenantCode.toUpperCase() !== targetTenant)) {
      return apiError("无权在该组织下创建小组", "FORBIDDEN");
    }
  }

  const { data, error } = await db
    .from("teams")
    .insert({ dept_id: deptId, tenant_code: targetTenant, name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "create",
    resourceType: "team",
    resourceId: data.id,
    resourceName: data.name,
    detail: { tenant_code: targetTenant, dept_id: deptId },
  });
  return NextResponse.json(data, { status: 201 });
}
