import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const tenantCode = req.nextUrl.searchParams.get("tenantCode") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "100"), 500);

  let query = db
    .from("logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (tenantCode) query = query.eq("tenant_code", tenantCode);
  if (search) {
    query = query.or(
      `user_phone.ilike.%${search}%,tenant_code.ilike.%${search}%,agent_name.ilike.%${search}%`
    );
  }

  const { data } = await query;
  return NextResponse.json(data ?? []);
}
