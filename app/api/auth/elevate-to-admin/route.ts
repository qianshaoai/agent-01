import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { db } from "@/lib/db";
import {
  getCurrentUser,
  signToken,
  buildAdminSetCookieHeader,
  AdminRole,
} from "@/lib/auth";
import { checkLoginRate, recordLoginFail, clearLoginFail } from "@/lib/rate-limit";
import { hasAnyCustomRole } from "@/lib/permission-actor";

// 5.28up · 用户端「管理后台」一键入口 · 颁 admin cookie
//
// 流程：用户态已登录的人点首页右上「管理后台」按钮 → 本接口 → 重查 DB 确认仍是 admin
//      → 颁 admin cookie（与 admin/login 同款 token / 同 30 天 TTL）→ 前端新 tab 打开
//      /admin/dashboard 时 middleware 见 admin cookie 直接放行，无需重新输密码。
//
// 安全（小B 复审重点）：
//   ① 不能信 user JWT 里的 role —— JWT 可能是几天前签的、中间 role 被降权 → 必须重查 DB
//   ② status 必须 'active'（拒 deleted / disabled / cancelled）
//   ③ role 必须 ∈ {super_admin, system_admin, org_admin}
//   ④ org_admin 还要查租户 enabled 且未过期（复用 admin/login 同款校验）
//   ⑤ 限流：防被滥用刷 admin cookie（同 IP / 同账号短时间多次失败锁定）
//
// 与 admin/login 的区别：本接口**不需要密码** —— 因为 user 已用密码登录过、user cookie 有效
//   就证明身份；本接口只是"复用同一身份"翻一个 token 出来而已。

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError("未登录", "UNAUTHORIZED");

  // 限流键按 userId（不按 IP —— 多 user 共用 IP 时易误伤）
  const rateKey = `elevate:${user.userId}`;
  const rate = checkLoginRate(rateKey);
  if (rate.locked) {
    return NextResponse.json(
      { error: `操作过于频繁，请 ${Math.ceil((rate.retryAfterSec ?? 0) / 60)} 分钟后再试` },
      { status: 429 },
    );
  }

  // ① 重查 DB —— 不信 JWT
  const { data: dbUser, error: dbErr } = await db
    .from("users")
    .select("id, phone, username, role, status, tenant_code, first_login")
    .eq("id", user.userId)
    .maybeSingle();
  if (dbErr) {
    console.error("[elevate-to-admin] 查询用户失败", dbErr);
    return apiError("查询用户失败，请重试", "INTERNAL_ERROR");
  }
  if (!dbUser) {
    recordLoginFail(rateKey);
    return apiError("账号不存在", "UNAUTHORIZED");
  }

  // ② status 检查
  if (dbUser.status === "deleted") {
    recordLoginFail(rateKey);
    return apiError("账号不存在", "UNAUTHORIZED");
  }
  if (dbUser.status === "cancelled") {
    recordLoginFail(rateKey);
    return apiError("该账号已注销", "UNAUTHORIZED");
  }
  if (dbUser.status === "disabled") {
    recordLoginFail(rateKey);
    return apiError("该账号已被禁用", "UNAUTHORIZED");
  }

  // ③ role 检查
  const role = dbUser.role as string;
  if (!["super_admin", "system_admin", "org_admin"].includes(role)) {
    // 6.4up · custom admin 入口：role='user' 但持有 custom role → 签 custom access cookie
    // 与 admin/login 第 2 路径同口径；不挂 firstLogin 闸门（用户层登录态已 active）。
    if (await hasAnyCustomRole(dbUser.id)) {
      clearLoginFail(rateKey);
      const token = await signToken({
        type: "admin",
        source: "custom_admin",
        userId: dbUser.id,
        username: dbUser.username ?? dbUser.phone,
      });
      return NextResponse.json(
        { ok: true },
        { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } },
      );
    }
    // 不计入限流——这是"前端按钮不该出现"的兜底，不算恶意尝试
    return apiError("该账号无后台访问权限", "FORBIDDEN");
  }

  // ④ 5.28up 小B 复审 Fix 2：first_login=true 的 admin 必须先走「后台登录页 →
  //   强制改密码」流程，不能从前台一键 SSO 进后台绕过。
  //   理由：admin/login 对 first_login=true 返回 mustChangePassword=true，
  //   后台登录页 (app/admin/page.tsx) 强制走改密码分支才能进 dashboard；
  //   本接口若不挡，admin role + 仍是初始密码的人能从首页盾牌一键进后台、跳过改密码。
  //   非 super_admin 才检查（与 admin/login 第 123 行同口径：super_admin 不要求改初始密码）。
  if (role !== "super_admin" && dbUser.first_login === true) {
    return apiError(
      "首次登录需先在管理后台修改初始密码，请直接打开后台登录页",
      "FORBIDDEN",
    );
  }

  // ⑤ org_admin · 校验租户（同 admin/login 97-109 行）
  if (role === "org_admin" && dbUser.tenant_code) {
    const { data: tenant } = await db
      .from("tenants")
      .select("enabled, expires_at")
      .eq("code", dbUser.tenant_code)
      .single();
    if (!tenant || !tenant.enabled) {
      return apiError("所属组织已被禁用，无法进入后台", "FORBIDDEN");
    }
    if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
      return apiError("所属组织已过期，无法进入后台", "FORBIDDEN");
    }
  }

  // 全部校验通过
  clearLoginFail(rateKey);

  const token = await signToken({
    type: "admin",
    adminId: dbUser.id,
    username: dbUser.username ?? dbUser.phone,
    role: role as AdminRole,
    tenantCode: role === "org_admin" ? dbUser.tenant_code : null,
    source: "user_admin",
  });

  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } },
  );
}
