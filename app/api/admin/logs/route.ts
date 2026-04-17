import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { PAGINATION } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const tenantCode = searchParams.get("tenantCode") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));

  let query = db
    .from("logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 组织管理员只能看自己组织的日志
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return NextResponse.json({ data: [], pagination: { page, pageSize, total: 0 } });
    query = query.eq("tenant_code", admin.tenantCode);
  } else if (tenantCode) {
    query = query.eq("tenant_code", tenantCode);
  }

  if (status) query = query.eq("status", status);
  if (search) {
    query = query.or(
      `user_phone.ilike.%${search}%,tenant_code.ilike.%${search}%,agent_name.ilike.%${search}%`
    );
  }

  const start = (page - 1) * pageSize;
  const { data, count, error } = await query.range(start, start + pageSize - 1);

  if (error) return dbError(error);
  return NextResponse.json({ data: data ?? [], pagination: { page, pageSize, total: count ?? 0 } });
}
