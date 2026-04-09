import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// 公开接口：根据组织码获取公告（全局 + 组织专属）
export async function GET(req: NextRequest) {
  const tenantCode = req.nextUrl.searchParams.get("tenantCode") ?? "PERSONAL";

  // 全局公告（tenant_code IS NULL）
  const { data: global } = await db
    .from("notices")
    .select("id, tenant_code, content, enabled")
    .is("tenant_code", null)
    .eq("enabled", true)
    .order("created_at", { ascending: false });

  // 组织专属公告
  const { data: enterprise } = await db
    .from("notices")
    .select("id, tenant_code, content, enabled")
    .eq("tenant_code", tenantCode)
    .eq("enabled", true)
    .order("created_at", { ascending: false });

  return NextResponse.json([...(global ?? []), ...(enterprise ?? [])]);
}
