import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signToken, buildSetCookieHeader } from "@/lib/auth";

// Create /app/api/admin/login directory
export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "请填写用户名和密码" }, { status: 400 });
  }

  const { data: admin } = await db
    .from("admins")
    .select("*")
    .eq("username", username)
    .single();

  if (!admin) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, admin.pwd_hash);
  if (!ok) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  const token = await signToken({
    type: "admin",
    adminId: admin.id,
    username: admin.username,
  });

  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": buildSetCookieHeader(token) } }
  );
}
