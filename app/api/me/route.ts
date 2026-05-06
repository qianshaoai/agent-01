import { NextResponse } from "next/server";
import { getActiveUser } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.userType === "trial") {
    return NextResponse.json({ error: "体验账号不可调用此接口", code: "FORBIDDEN" }, { status: 403 });
  }

  let quota = null;
  let tenantNameFromDb: string | null = null;
  if (!user.isPersonal) {
    const { data } = await db
      .from("tenants")
      .select("quota, quota_used, expires_at, name")
      .eq("code", user.tenantCode)
      .single();
    quota = data;
    tenantNameFromDb = data?.name ?? null;
  }

  return NextResponse.json({
    userId: user.userId,
    phone: user.phone,
    nickname: user.nickname,
    tenantCode: user.tenantCode,
    // 优先用 tenants 表里的最新 name，旧 JWT 里的 tenantName 可能是 code 兜底（历史 bug）
    tenantName: tenantNameFromDb || user.tenantName,
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
