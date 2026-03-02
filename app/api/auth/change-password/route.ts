import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { oldPassword, newPassword } = await req.json();
  if (!oldPassword || !newPassword) {
    return NextResponse.json({ error: "请填写旧密码和新密码" }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "新密码至少 6 位" }, { status: 400 });
  }

  const { data: dbUser } = await db
    .from("users")
    .select("pwd_hash")
    .eq("id", user.userId)
    .single();

  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const ok = await bcrypt.compare(oldPassword, dbUser.pwd_hash);
  if (!ok) return NextResponse.json({ error: "旧密码错误" }, { status: 401 });

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .from("users")
    .update({ pwd_hash: newHash, first_login: false })
    .eq("id", user.userId);

  return NextResponse.json({ ok: true });
}
