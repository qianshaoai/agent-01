import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getDbUser(user: { phone: string; tenantCode: string }) {
  const { data } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();
  return data;
}

// PATCH: 更新会话（改名 / 更新进度 / 标记完成）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id } = await params;
  const body = await req.json();
  const dbUser = await getDbUser(user);
  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  // 只允许更新自己的会话
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.currentStepIdx === "number") updates.current_step_idx = body.currentStepIdx;
  if (typeof body.status === "string") updates.status = body.status;

  const { data, error } = await db
    .from("workflow_sessions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", dbUser.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  return NextResponse.json(data);
}

// DELETE: 删除会话（同时级联清除该会话下的对话 session_id 引用）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id } = await params;
  const dbUser = await getDbUser(user);
  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const { error } = await db
    .from("workflow_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", dbUser.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
