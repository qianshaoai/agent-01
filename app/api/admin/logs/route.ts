import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权或权限已变更" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search") ?? "";
  const status = req.nextUrl.searchParams.get("status") ?? "";
  const tenantCode = req.nextUrl.searchParams.get("tenantCode") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "100"), 500);

  let query = db
    .from("logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  // 组织管理员只能看自己组织的日志
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return NextResponse.json([]);
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

  const { data } = await query;
  return NextResponse.json(data ?? []);
}
