import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    adminId: admin.adminId,
    username: admin.username,
    role: admin.role ?? "super_admin",
    tenantCode: admin.tenantCode ?? null,
  });
}
