import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildSetCookieHeader } from "@/lib/auth";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PHONE_RE = /^\d{7,15}$/;

export async function POST(req: NextRequest) {
  try {
    const { userType, username, realName, phone, password, tenantCode } = await req.json();

    // ── 基础校验 ──────────────────────────────────────────────
    if (!userType || !["personal", "organization"].includes(userType)) {
      return NextResponse.json({ error: "请选择用户类型" }, { status: 400 });
    }
    if (!username || !USERNAME_RE.test(username)) {
      return NextResponse.json({ error: "用户名为 3~20 位字母、数字或下划线" }, { status: 400 });
    }
    if (!realName || realName.trim().length < 2 || realName.trim().length > 20) {
      return NextResponse.json({ error: "真实姓名为 2~20 个字符" }, { status: 400 });
    }
    if (!phone || !PHONE_RE.test(phone.trim())) {
      return NextResponse.json({ error: "手机号格式不正确" }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
    }

    const normalizedUsername = username.trim();
    const normalizedPhone = phone.trim();
    const normalizedReal = realName.trim();

    // ── 用户名唯一性 ──────────────────────────────────────────
    const { count: unameCount } = await db
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("username", normalizedUsername);
    if (unameCount && unameCount > 0) {
      return NextResponse.json({ error: "该用户名已被注册，请换一个" }, { status: 409 });
    }

    // ── 组织用户：校验组织码 ──────────────────────────────────
    let tenantName = "个人空间";
    let normalizedCode = "PERSONAL";

    if (userType === "organization") {
      if (!tenantCode?.trim()) {
        return NextResponse.json({ error: "组织用户必须填写组织码" }, { status: 400 });
      }
      normalizedCode = tenantCode.trim().toUpperCase();

      const { data: tenant } = await db
        .from("tenants")
        .select("*")
        .eq("code", normalizedCode)
        .eq("enabled", true)
        .single();

      if (!tenant) {
        return NextResponse.json({ error: "组织码无效或已禁用" }, { status: 400 });
      }
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "该组织码已到期，请联系管理员" }, { status: 400 });
      }
      tenantName = tenant.name;

      // 同一组织内手机号唯一
      const { count: phoneCount } = await db
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("phone", normalizedPhone)
        .eq("tenant_code", normalizedCode);
      if (phoneCount && phoneCount > 0) {
        return NextResponse.json({ error: "该手机号在此组织下已注册" }, { status: 409 });
      }
    } else {
      // 个人用户：手机号在个人空间唯一
      const { count: phoneCount } = await db
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("phone", normalizedPhone)
        .eq("tenant_code", "PERSONAL");
      if (phoneCount && phoneCount > 0) {
        return NextResponse.json({ error: "该手机号已注册" }, { status: 409 });
      }
    }

    // ── 创建用户 ──────────────────────────────────────────────
    const pwd_hash = await bcrypt.hash(password, 12);
    const { data: newUser, error } = await db
      .from("users")
      .insert({
        phone: normalizedPhone,
        username: normalizedUsername,
        real_name: normalizedReal,
        tenant_code: normalizedCode,
        pwd_hash,
        user_type: userType,
        role: "user",
        first_login: false,
        last_login_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !newUser) {
      console.error("[register]", error);
      return NextResponse.json({ error: "注册失败，请稍后重试" }, { status: 500 });
    }

    // ── 自动登录 ──────────────────────────────────────────────
    const token = await signToken({
      type: "user",
      userId: newUser.id,
      phone: normalizedPhone,
      tenantCode: normalizedCode,
      tenantName,
      isPersonal: userType === "personal",
    });

    return NextResponse.json(
      { ok: true },
      { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
    );
  } catch (e) {
    console.error("[register]", e);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
