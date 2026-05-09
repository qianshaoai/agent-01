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

// DELETE: 默认软删除（status=abandoned），用 ?hard=1 物理删除
// 软删除：会话从"进行中"列表消失，但进入"历史"页面可回看
// 物理删除：仅允许已完成或已放弃的会话，避免误删进行中
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

  const hard = req.nextUrl.searchParams.get("hard") === "1";

  if (hard) {
    // 物理删除前先校验状态：禁止物理删除进行中的会话
    const { data: existing } = await db
      .from("workflow_sessions")
      .select("status")
      .eq("id", id)
      .eq("user_id", dbUser.id)
      .single();
    if (!existing) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    if (existing.status === "in_progress") {
      return NextResponse.json({ error: "进行中会话不可永久删除，请先放弃" }, { status: 400 });
    }
    const { error } = await db
      .from("workflow_sessions")
      .delete()
      .eq("id", id)
      .eq("user_id", dbUser.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, mode: "hard" });
  }

  // 软删除：标记为 abandoned
  const { error } = await db
    .from("workflow_sessions")
    .update({ status: "abandoned", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", dbUser.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, mode: "soft" });
}
