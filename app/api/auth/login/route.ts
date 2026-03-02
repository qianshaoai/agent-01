import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildSetCookieHeader } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { phone, password, tenantCode } = await req.json();

    if (!phone || !password) {
      return NextResponse.json({ error: "请填写手机号和密码" }, { status: 400 });
    }

    const normalizedCode = tenantCode?.trim().toUpperCase() || "PERSONAL";
    const isPersonal = normalizedCode === "PERSONAL" || !tenantCode?.trim();

    // ── 企业码验证 ────────────────────────────────────────────
    let tenantName = "个人空间";
    if (!isPersonal) {
      const { data: tenant } = await db
        .from("tenants")
        .select("*")
        .eq("code", normalizedCode)
        .eq("enabled", true)
        .single();

      if (!tenant) {
        return NextResponse.json({ error: "企业码无效或已禁用" }, { status: 401 });
      }

      // 检查到期
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "该企业码已到期，请联系管理员" }, { status: 401 });
      }

      tenantName = tenant.name;

      // 先尝试找已有用户
      const { data: existingUser } = await db
        .from("users")
        .select("*")
        .eq("phone", phone)
        .eq("tenant_code", normalizedCode)
        .single();

      if (existingUser) {
        // 验证用户密码
        const ok = await bcrypt.compare(password, existingUser.pwd_hash);
        if (!ok) {
          return NextResponse.json({ error: "密码错误" }, { status: 401 });
        }
        const token = await signToken({
          type: "user",
          userId: existingUser.id,
          phone,
          tenantCode: normalizedCode,
          tenantName,
          isPersonal: false,
        });
        return NextResponse.json(
          { ok: true, firstLogin: existingUser.first_login, tenantName },
          { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
        );
      }

      // 新用户：验证企业初始密码
      const tenantPwdOk = await bcrypt.compare(password, tenant.pwd_hash);
      if (!tenantPwdOk) {
        return NextResponse.json({ error: "企业码或密码错误" }, { status: 401 });
      }

      // 创建企业用户（初始密码 = 企业密码）
      const pwdHash = await bcrypt.hash(password, 12);
      const { data: newUser, error } = await db
        .from("users")
        .insert({ phone, tenant_code: normalizedCode, pwd_hash: pwdHash, first_login: true })
        .select()
        .single();

      if (error || !newUser) {
        return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
      }

      const token = await signToken({
        type: "user",
        userId: newUser.id,
        phone,
        tenantCode: normalizedCode,
        tenantName,
        isPersonal: false,
      });

      return NextResponse.json(
        { ok: true, firstLogin: true, tenantName },
        { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
      );
    }

    // ── 个人空间逻辑 ──────────────────────────────────────────
    const { data: existingUser } = await db
      .from("users")
      .select("*")
      .eq("phone", phone)
      .eq("tenant_code", "PERSONAL")
      .single();

    if (existingUser) {
      const ok = await bcrypt.compare(password, existingUser.pwd_hash);
      if (!ok) {
        return NextResponse.json({ error: "密码错误" }, { status: 401 });
      }
      const token = await signToken({
        type: "user",
        userId: existingUser.id,
        phone,
        tenantCode: "PERSONAL",
        tenantName: "个人空间",
        isPersonal: true,
      });
      return NextResponse.json(
        { ok: true, firstLogin: existingUser.first_login },
        { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
      );
    }

    // 个人用户首次登录：验证默认密码 000000
    if (password !== "000000") {
      return NextResponse.json(
        { error: "个人用户初始密码为 000000" },
        { status: 401 }
      );
    }

    const pwdHash = await bcrypt.hash("000000", 12);
    const { data: newUser, error } = await db
      .from("users")
      .insert({ phone, tenant_code: "PERSONAL", pwd_hash: pwdHash, first_login: true })
      .select()
      .single();

    if (error || !newUser) {
      return NextResponse.json({ error: "创建用户失败" }, { status: 500 });
    }

    const token = await signToken({
      type: "user",
      userId: newUser.id,
      phone,
      tenantCode: "PERSONAL",
      tenantName: "个人空间",
      isPersonal: true,
    });

    return NextResponse.json(
      { ok: true, firstLogin: true },
      { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
    );
  } catch (e) {
    console.error("[login]", e);
    return NextResponse.json({ error: "服务器错误，请稍后重试" }, { status: 500 });
  }
}
