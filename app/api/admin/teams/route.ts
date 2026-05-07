import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { page, pageSize, start } = parsePagination(req, 100);
  const deptId = req.nextUrl.searchParams.get("deptId");
  let tenantCode = req.nextUrl.searchParams.get("tenantCode");
  // 5.7up · org_admin 强制本组织
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    tenantCode = admin.tenantCode;
  }

  let query = db.from("teams").select("*", { count: "exact" }).order("sort_order").order("created_at");
  if (deptId) query = query.eq("dept_id", deptId);
  if (tenantCode) query = query.eq("tenant_code", tenantCode);

  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) return dbError(error);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { deptId, tenantCode, name, sortOrder } = await req.json();
  if (!deptId || !tenantCode || !name?.trim()) {
    return apiError("请填写部门和小组名称", "VALIDATION_ERROR");
  }

  const targetTenant = String(tenantCode).toUpperCase();
  // 5.7up · org_admin 只能在自己组织建小组
  if (admin.role === "org_admin") {
    if (!admin.tenantCode || admin.tenantCode.toUpperCase() !== targetTenant) {
      return apiError("无权在该组织下创建小组", "FORBIDDEN");
    }
  }

  const { data, error } = await db
    .from("teams")
    .insert({ dept_id: deptId, tenant_code: targetTenant, name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
