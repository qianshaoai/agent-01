import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildSetCookieHeader } from "@/lib/auth";

function statusError(status: string) {
  if (status === "deleted") return "该账号已注销，无法登录";
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

    // ── 全局查找用户（用户名唯一；手机号可能跨租户重复）────────
    const { data: matches } = await db
      .from("users")
      .select("*")
      .or(`phone.eq.${identifier},username.eq.${identifier}`);

    if (!matches || matches.length === 0) {
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
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }

    // 若是组织用户，校验组织是否仍有效
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
    }

    await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

    const tenantName = user.tenant_code === "PERSONAL" ? "个人空间" : user.tenant_code;
    const token = await signToken({
      type: "user",
      userId: user.id,
      phone: user.phone,
      tenantCode: user.tenant_code,
      tenantName,
      isPersonal: user.tenant_code === "PERSONAL",
    });

    return NextResponse.json(
      { ok: true, firstLogin: user.first_login, tenantName },
      { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
    );
  } catch (e) {
    console.error("[login]", e);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
