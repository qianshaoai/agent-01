import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUser, buildClearCookieHeader } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { password } = await req.json();
  if (!password) return NextResponse.json({ error: "请输入密码" }, { status: 400 });

  const { data: dbUser } = await db
    .from("users")
    .select("pwd_hash, status")
    .eq("id", user.userId)
    .single();

  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (dbUser.status === "cancelled" || dbUser.status === "deleted") {
    return NextResponse.json({ error: "账号已注销" }, { status: 400 });
  }

  const ok = await bcrypt.compare(password, dbUser.pwd_hash);
  if (!ok) return NextResponse.json({ error: "密码错误" }, { status: 401 });

  // cancelled = 用户自己注销账号（区别于管理员"删除"用的 deleted 状态）
  await db.from("users").update({ status: "cancelled" }).eq("id", user.userId);

  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": buildClearCookieHeader() } }
  );
}
