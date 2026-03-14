import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // ── 修改账号状态 ────────────────────────────────────────
  if (body.action === "set-status") {
    const { status } = body;
    if (!["active", "disabled"].includes(status)) {
      return NextResponse.json({ error: "状态值无效" }, { status: 400 });
    }
    const { error } = await db.from("users").update({ status }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ── 重置密码 ────────────────────────────────────────────
  if (body.action === "reset-password") {
    const { newPassword } = body;
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
    }
    const pwd_hash = await bcrypt.hash(newPassword, 12);
    const { error } = await db
      .from("users")
      .update({ pwd_hash, first_login: true })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
