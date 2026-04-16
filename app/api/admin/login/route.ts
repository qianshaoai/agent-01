import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildAdminSetCookieHeader, AdminRole } from "@/lib/auth";
import { checkLoginRate, recordLoginFail, clearLoginFail } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "请填写用户名和密码" }, { status: 400 });
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
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }
    clearLoginFail(rateKey);

    const token = await signToken({
      type: "admin",
      adminId: admin.id,
      username: admin.username,
      role: (admin.role as AdminRole) ?? "super_admin",
      tenantCode: admin.tenant_code ?? null,
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
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
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
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  // 状态检查
  if (matchedUser.status === "deleted") {
    return NextResponse.json({ error: "账号不存在" }, { status: 401 });
  }
  if (matchedUser.status === "cancelled") {
    return NextResponse.json({ error: "该账号已注销，无法登录" }, { status: 401 });
  }
  if (matchedUser.status === "disabled") {
    return NextResponse.json({ error: "该账号已被禁用" }, { status: 401 });
  }

  // 角色检查：必须是 super_admin / system_admin / org_admin 才能进后台
  const role = matchedUser.role as string;
  if (!["super_admin", "system_admin", "org_admin"].includes(role)) {
    return NextResponse.json({ error: "该账号无后台访问权限" }, { status: 403 });
  }

  // org_admin 需要校验租户是否启用/过期
  if (role === "org_admin" && matchedUser.tenant_code) {
    const { data: tenant } = await db
      .from("tenants")
      .select("enabled, expires_at")
      .eq("code", matchedUser.tenant_code)
      .single();
    if (!tenant || !tenant.enabled) {
      return NextResponse.json({ error: "所属组织已被禁用，无法登录" }, { status: 403 });
    }
    if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
      return NextResponse.json({ error: "所属组织已过期，无法登录" }, { status: 403 });
    }
  }

  // 所有校验通过，清空失败记录
  clearLoginFail(rateKey);

  const token = await signToken({
    type: "admin",
    adminId: matchedUser.id,
    username: matchedUser.username ?? matchedUser.phone,
    role: role as AdminRole,
    tenantCode: role === "org_admin" ? matchedUser.tenant_code : null,
  });

  // 非超管在首次登录（仍使用初始密码）时必须修改密码
  const mustChangePassword = role !== "super_admin" && matchedUser.first_login === true;

  return NextResponse.json(
    { ok: true, mustChangePassword },
    { headers: { "Set-Cookie": buildAdminSetCookieHeader(token) } }
  );
}
