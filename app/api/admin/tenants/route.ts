import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data } = await db
    .from("tenants")
    .select("id, code, name, quota, quota_used, expires_at, enabled, created_at")
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { code, name, initialPwd, quota, expiresAt } = await req.json();
  if (!code || !name || !initialPwd || !quota || !expiresAt) {
    return NextResponse.json({ error: "请填写所有必填字段" }, { status: 400 });
  }

  if (!/^[A-Za-z]{4,8}$/.test(code.trim())) {
    return NextResponse.json({ error: "组织码只能为 4~8 位英文字母" }, { status: 400 });
  }

  const normalizedCode = code.trim().toUpperCase();
  const pwdHash = await bcrypt.hash(initialPwd, 12);

  const { data, error } = await db
    .from("tenants")
    .insert({
      code: normalizedCode,
      name,
      pwd_hash: pwdHash,
      quota: Number(quota),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "组织码已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
