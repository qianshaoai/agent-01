import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

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

  const { data, error } = await db
    .from("departments")
    .insert({ tenant_code: targetTenant, name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
