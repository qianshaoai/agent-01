import { NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未登录或权限已变更" }, { status: 401 });
  return NextResponse.json({
    adminId: admin.adminId,
    username: admin.username,
    role: admin.role ?? "super_admin",
    tenantCode: admin.tenantCode ?? null,
  });
}
