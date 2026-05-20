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

// 5.16up R3 · 会话状态流转白名单：key = 目标状态，value = 允许的来源状态
//   abandoned  → in_progress：恢复已放弃的工作流
//   in_progress → completed ：标记完成
//   in_progress → abandoned ：放弃
// 只约束带 status 的请求；纯改名 / 改进度（不带 status）不受影响
const VALID_SESSION_STATUSES = ["in_progress", "completed", "abandoned"];
const STATUS_TRANSITIONS: Record<string, string[]> = {
  in_progress: ["abandoned"],
  completed: ["in_progress"],
  abandoned: ["in_progress"],
};

// PATCH: 更新会话（改名 / 更新进度 / 恢复 / 标记完成 / 放弃）
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

  // 5.16up R3 · 仅带 status 的请求才走状态流转白名单；纯改名 / 改进度不受影响
  if (typeof body.status === "string") {
    const target = body.status;
    if (!VALID_SESSION_STATUSES.includes(target)) {
      return NextResponse.json({ error: `不支持的状态：${target}` }, { status: 422 });
    }
    // 先取当前状态（顺带按 user_id 校验归属：只能动自己的会话）
    const { data: current, error: curErr } = await db
      .from("workflow_sessions")
      .select("status")
      .eq("id", id)
      .eq("user_id", dbUser.id)
      .maybeSingle();
    if (curErr) return NextResponse.json({ error: "加载会话失败" }, { status: 500 });
    if (!current) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

    // 同状态视为幂等、放行；否则来源状态必须在白名单内
    if (current.status !== target && !(STATUS_TRANSITIONS[target] ?? []).includes(current.status)) {
      return NextResponse.json(
        { error: `不允许从「${current.status}」变更为「${target}」` },
        { status: 422 },
      );
    }
    updates.status = target;
  }

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
