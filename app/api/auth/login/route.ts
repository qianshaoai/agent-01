import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildSetCookieHeader } from "@/lib/auth";
import { checkLoginRate, recordLoginFail, clearLoginFail } from "@/lib/rate-limit";

function statusError(status: string) {
  if (status === "cancelled") return "该账号已注销，无法登录";
  if (status === "deleted") return "账号不存在";
  if (status === "disabled") return "该账号已被禁用，请联系管理员";
  return "账号状态异常";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier: string = (body.identifier ?? body.phone ?? "").trim();
    const { password } = body;

    if (!identifier || !password) {
      return NextResponse.json({ error: "请填写账号和密码" }, { status: 400 });
    }

    // 登录限流：15 分钟内同一账号连续 5 次失败后锁定 15 分钟
    const rateKey = `user:${identifier.toLowerCase()}`;
    const rate = checkLoginRate(rateKey);
    if (rate.locked) {
      return NextResponse.json(
        { error: `登录失败次数过多，请 ${Math.ceil((rate.retryAfterSec ?? 0) / 60)} 分钟后再试` },
        { status: 429 }
      );
    }

    // ── 全局查找用户（用户名唯一；手机号可能跨租户重复）────────
    // 注：不用 .or() 字符串语法，避免纯数字 identifier 在 PostgREST 产生类型歧义
    const [{ data: byPhone }, { data: byUsername }] = await Promise.all([
      db.from("users").select("*").eq("phone", identifier),
      db.from("users").select("*").eq("username", identifier),
    ]);
    const matches = [
      ...(byPhone ?? []),
      ...(byUsername ?? []).filter((u) => !byPhone?.some((p) => p.id === u.id)),
    ];

    if (!matches || matches.length === 0) {
      recordLoginFail(rateKey);
      return NextResponse.json({ error: "账号不存在，请先注册" }, { status: 401 });
    }

    // 手机号在多个组织下重复时，要求改用用户名登录
    if (matches.length > 1) {
      return NextResponse.json(
        { error: "该手机号存在多个账号，请使用用户名登录" },
        { status: 409 }
      );
    }

    const user = matches[0];

    if (user.status !== "active") {
      return NextResponse.json({ error: statusError(user.status) }, { status: 401 });
    }

    const ok = await bcrypt.compare(password, user.pwd_hash);
    if (!ok) {
      recordLoginFail(rateKey);
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }
    // 登录成功，清空该 key 的失败记录
    clearLoginFail(rateKey);

    // 若是组织用户，校验组织是否仍有效
    let tenantNameFromDb: string | null = null;
    if (user.tenant_code !== "PERSONAL") {
      const { data: tenant } = await db
        .from("tenants")
        .select("name, expires_at, enabled")
        .eq("code", user.tenant_code)
        .single();

      if (!tenant || !tenant.enabled) {
        return NextResponse.json({ error: "所属组织已禁用，请联系管理员" }, { status: 401 });
      }
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "所属组织已到期，请联系管理员" }, { status: 401 });
      }
      tenantNameFromDb = tenant.name ?? null;
    }

    await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

    const tenantName =
      user.tenant_code === "PERSONAL"
        ? "个人空间"
        : tenantNameFromDb || user.tenant_code; // tenants.name 兜底用 code
    const token = await signToken({
      type: "user",
      userId: user.id,
      phone: user.phone,
      tenantCode: user.tenant_code,
      tenantName,
      isPersonal: user.tenant_code === "PERSONAL",
      role: user.role ?? "user",
      userType: user.user_type ?? "personal",
    });

    return NextResponse.json(
      {
        ok: true,
        firstLogin: user.first_login,
        tenantName,
        userType: user.user_type ?? "personal",
      },
      { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
    );
  } catch (e) {
    console.error("[login]", e);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
