import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildAdminSetCookieHeader, AdminRole } from "@/lib/auth";
import { checkLoginRate, recordLoginFail, clearLoginFail } from "@/lib/rate-limit";
import { hasAnyCustomRole } from "@/lib/permission-actor";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return apiError("请填写用户名和密码", "VALIDATION_ERROR");
  }

  const identifier = username.trim();

  // 登录限流：15 分钟内同一账号连续 5 次失败后锁定 15 分钟
  const rateKey = `admin:${identifier.toLowerCase()}`;
  const rate = checkLoginRate(rateKey);
  if (rate.locked) {
    return NextResponse.json(
      { error: `登录失败次数过多，请 ${Math.ceil((rate.retryAfterSec ?? 0) / 60)} 分钟后再试` },
      { status: 429 }
    );
  }

  // ── 方式 1：admins 表（系统内置管理员，例如默认 admin 账号）──────
  const { data: admin } = await db
    .from("admins")
    .select("*")
    .eq("username", identifier)
    .single();

  if (admin) {
    const ok = await bcrypt.compare(password, admin.pwd_hash);
    if (!ok) {
      recordLoginFail(rateKey);
      return apiError("用户名或密码错误", "UNAUTHORIZED");
    }
    clearLoginFail(rateKey);

    const token = await signToken({
      type: "admin",
      adminId: admin.id,
      username: admin.username,
      role: (admin.role as AdminRole) ?? "super_admin",
      tenantCode: admin.tenant_code ?? null,
      source: "admin_table",
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } }
    );
  }

  // ── 方式 2：users 表（普通用户中被赋予了管理员角色的）────────────
  //   支持手机号 / 用户名登录，角色必须 ≠ 'user' 才能进后台
  const { data: userMatches } = await db
    .from("users")
    .select("*")
    .or(`phone.eq.${identifier},username.eq.${identifier}`);

  if (!userMatches || userMatches.length === 0) {
    recordLoginFail(rateKey);
    return apiError("用户名或密码错误", "UNAUTHORIZED");
  }

  // 手机号可能跨组织重复，尝试匹配所有候选
  let matchedUser = null;
  for (const u of userMatches) {
    if (await bcrypt.compare(password, u.pwd_hash)) {
      matchedUser = u;
      break;
    }
  }
  if (!matchedUser) {
    recordLoginFail(rateKey);
    return apiError("用户名或密码错误", "UNAUTHORIZED");
  }

  // 状态检查
  if (matchedUser.status === "deleted") {
    return apiError("账号不存在", "UNAUTHORIZED");
  }
  if (matchedUser.status === "cancelled") {
    return apiError("该账号已注销，无法登录", "UNAUTHORIZED");
  }
  if (matchedUser.status === "disabled") {
    return apiError("该账号已被禁用", "UNAUTHORIZED");
  }

  // 角色检查：必须是 super_admin / system_admin / org_admin 才能进后台
  const role = matchedUser.role as string;
  if (!["super_admin", "system_admin", "org_admin"].includes(role)) {
    // 6.4up · custom admin 入口：role='user' 但持有 custom role 时，签 custom access cookie
    //   - 不签 builtin AdminPayload（无 adminId / role），避免被 requireAdmin 误识为 builtin
    //   - 不挂 firstLogin 闸门（custom role 不要求初始改密；用户层的首登流程在 /api/auth/login 已经做了）
    //   - middleware 仍校验 token freshness + cookie 存在性
    if (await hasAnyCustomRole(matchedUser.id)) {
      // R2 Fix 4 · 与 builtin org_admin 同口径：所属组织必须 enabled 且未过期才放行
      //   PERSONAL / 空 tenant_code 跳过（个人用户也可能配 custom role）
      if (matchedUser.tenant_code && matchedUser.tenant_code !== "PERSONAL") {
        const { data: tenant } = await db
          .from("tenants")
          .select("enabled, expires_at")
          .eq("code", matchedUser.tenant_code)
          .single();
        if (!tenant || !tenant.enabled) {
          return apiError("所属组织已被禁用，无法登录", "FORBIDDEN");
        }
        if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
          return apiError("所属组织已过期，无法登录", "FORBIDDEN");
        }
      }
      clearLoginFail(rateKey);
      const token = await signToken({
        type: "admin",
        source: "custom_admin",
        userId: matchedUser.id,
        username: matchedUser.username ?? matchedUser.phone,
      });
      return NextResponse.json(
        { ok: true, mustChangePassword: false },
        { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } }
      );
    }
    return apiError("该账号无后台访问权限", "FORBIDDEN");
  }

  // org_admin 需要校验租户是否启用/过期
  if (role === "org_admin" && matchedUser.tenant_code) {
    const { data: tenant } = await db
      .from("tenants")
      .select("enabled, expires_at")
      .eq("code", matchedUser.tenant_code)
      .single();
    if (!tenant || !tenant.enabled) {
      return apiError("所属组织已被禁用，无法登录", "FORBIDDEN");
    }
    if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
      return apiError("所属组织已过期，无法登录", "FORBIDDEN");
    }
  }

  // 所有校验通过，清空失败记录
  clearLoginFail(rateKey);

  // 非超管在首次登录（仍使用初始密码）时必须修改密码
  const mustChangePassword = role !== "super_admin" && matchedUser.first_login === true;

  // 5.28up 小B 复审 R3 Fix 1 · 防绕过强制改密码
  //   旧实现：first_login=true 也照常签普通 admin cookie，前端 mustChangePassword 只是
  //     "建议" —— 用户改 URL 直接进 /admin/dashboard 就绕过去了。
  //   新实现：mustChangePassword=true 时 token payload 带 firstLogin=true：
  //     - middleware 见此字段把页面访问重定向到 /admin（强制走改密码页）
  //     - requireAdmin 默认拒绝带 firstLogin=true 的 token（仅 change-password 豁免）
  //     - change-password 改完密码后重签新 token 不带 firstLogin，闸门解除
  const token = await signToken({
    type: "admin",
    adminId: matchedUser.id,
    username: matchedUser.username ?? matchedUser.phone,
    role: role as AdminRole,
    tenantCode: role === "org_admin" ? matchedUser.tenant_code : null,
    source: "user_admin",
    ...(mustChangePassword ? { firstLogin: true } : {}),
  });

  return NextResponse.json(
    { ok: true, mustChangePassword },
    { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } }
  );
}
