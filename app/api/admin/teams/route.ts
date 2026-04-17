import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const deptId = req.nextUrl.searchParams.get("deptId");
  const tenantCode = req.nextUrl.searchParams.get("tenantCode");
  let query = db.from("teams").select("*").order("sort_order").order("created_at").limit(500);
  if (deptId) query = query.eq("dept_id", deptId);
  if (tenantCode) query = query.eq("tenant_code", tenantCode);

  const { data, error } = await query;
  if (error) return dbError(error);
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { deptId, tenantCode, name, sortOrder } = await req.json();
  if (!deptId || !tenantCode || !name?.trim()) {
    return NextResponse.json({ error: "请填写部门和小组名称" }, { status: 400 });
  }

  const { data, error } = await db
    .from("teams")
    .insert({ dept_id: deptId, tenant_code: tenantCode.toUpperCase(), name: name.trim(), sort_order: sortOrder ?? 0 })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
