import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

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
  return NextResponse.json(data, { status: 201 });
}
