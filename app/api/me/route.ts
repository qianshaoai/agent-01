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

  // 5.29up · 用户端「管理后台」按钮的渲染依据：
  //   role 在 super_admin / system_admin / org_admin 三选一 → 当前账号有后台权限
  //   普通员工 role='user' → isAdmin=false → 前端不渲染该按钮
  // 这里只看 users.role；不查 admins 表 —— admins 表是系统内置账号（默认 admin），
  //   前台只能手机号登录、不会出现在用户态
  const isAdmin =
    user.role === "super_admin" ||
    user.role === "system_admin" ||
    user.role === "org_admin";

  return NextResponse.json({
    userId: user.userId,
    phone: user.phone,
    nickname: user.nickname,
    tenantCode: user.tenantCode,
    // 优先用 tenants 表里的最新 name，旧 JWT 里的 tenantName 可能是 code 兜底（历史 bug）
    tenantName: tenantNameFromDb || user.tenantName,
    isPersonal: user.isPersonal,
    role: user.role,
    isAdmin,
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
