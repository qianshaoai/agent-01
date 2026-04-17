import { dbError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { page, pageSize, start } = parsePagination(req, 100);
  const tenantCode = req.nextUrl.searchParams.get("tenantCode");
  let query = db.from("departments").select("*", { count: "exact" }).order("sort_order").order("created_at");
  if (tenantCode) query = query.eq("tenant_code", tenantCode);

  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) return dbError(error);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { tenantCode, name, sortOrder } = await req.json();
  if (!tenantCode || !name?.trim()) {
    return NextResponse.json({ error: "请填写组织码和部门名称" }, { status: 400 });
  }

  const { data, error } = await db
    .from("departments")
    .insert({ tenant_code: tenantCode.toUpperCase(), name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
