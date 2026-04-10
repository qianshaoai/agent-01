import { NextResponse } from "next/server";
import { getActiveUser } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let quota = null;
  if (!user.isPersonal) {
    const { data } = await db
      .from("tenants")
      .select("quota, quota_used, expires_at, name")
      .eq("code", user.tenantCode)
      .single();
    quota = data;
  }

  return NextResponse.json({
    userId: user.userId,
    phone: user.phone,
    nickname: user.nickname,
    tenantCode: user.tenantCode,
    tenantName: user.tenantName,
    isPersonal: user.isPersonal,
    role: user.role,
    userType: user.userType,
    status: user.status,
    createdAt: user.createdAt,
    quota: quota
      ? {
          total: quota.quota,
          used: quota.quota_used,
          left: quota.quota - quota.quota_used,
          expiresAt: quota.expires_at,
        }
      : null,
  });
}
