import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { nickname } = await req.json();
  const trimmed = (nickname ?? "").trim();

  if (!trimmed) return NextResponse.json({ error: "用户名不能为空" }, { status: 400 });
  if (trimmed.length < 2 || trimmed.length > 20) {
    return NextResponse.json({ error: "用户名长度为 2~20 个字符" }, { status: 400 });
  }

  const { error } = await db
    .from("users")
    .update({ nickname: trimmed })
    .eq("id", user.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
