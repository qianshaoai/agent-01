import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/messages/[id]?from=true
 *
 * 删除该消息及之后所有消息（用于"编辑用户消息重发 / 重新生成 assistant"）。
 * 鉴权链路：messages.conversation_id → conversations.user_id 必须等于当前用户。
 *
 * **不带 from=true 直接 400**（本接口仅支持"该条及之后"模式）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });

  const url = new URL(req.url);
  if (url.searchParams.get("from") !== "true") {
    return NextResponse.json(
      { error: "本接口仅支持 ?from=true（删除该消息及之后所有）" },
      { status: 400 }
    );
  }

  // 1) 拿这条消息的 conversation_id 和 created_at
  const { data: msgRow } = await db
    .from("messages")
    .select("id, conversation_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!msgRow) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }

  // 2) 鉴权：通过 conversation 反查到 user_id 并比对
  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();
  if (!dbUser) {
    return NextResponse.json({ error: "无权删除该消息" }, { status: 404 });
  }
  const { data: conv } = await db
    .from("conversations")
    .select("user_id")
    .eq("id", msgRow.conversation_id)
    .maybeSingle();
  if (!conv || conv.user_id !== dbUser.id) {
    return NextResponse.json({ error: "无权删除该消息" }, { status: 404 });
  }

  // 3) 删该消息 + 之后所有（同 conversation 内 created_at >= 该消息）
  const { error, count } = await db
    .from("messages")
    .delete({ count: "exact" })
    .eq("conversation_id", msgRow.conversation_id)
    .gte("created_at", msgRow.created_at);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}

/**
 * PATCH /api/messages/[id]
 * body: { aborted: true }
 *
 * 4.30up · A 方案：标记此条消息（user 或 assistant）为"被用户主动中断"。
 * 后续 chat 路由拉历史时会 .eq("aborted", false) 过滤掉，避免被中断的 turn
 * 进入 bot 上下文造成幻觉。前端仍正常渲染该消息 + 已停止徽章。
 *
 * 鉴权：与 DELETE 同链路，messages.conversation_id → conversations.user_id 必须 = 当前用户。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  if (body.aborted !== true) {
    return NextResponse.json(
      { error: "本接口仅支持 { aborted: true }（标记中断），其它字段不允许更改" },
      { status: 400 }
    );
  }

  // 鉴权链路（与 DELETE 同）
  const { data: msgRow } = await db
    .from("messages")
    .select("id, conversation_id")
    .eq("id", id)
    .maybeSingle();
  if (!msgRow) return NextResponse.json({ error: "消息不存在" }, { status: 404 });

  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();
  if (!dbUser) return NextResponse.json({ error: "无权操作该消息" }, { status: 404 });

  const { data: conv } = await db
    .from("conversations")
    .select("user_id")
    .eq("id", msgRow.conversation_id)
    .maybeSingle();
  if (!conv || conv.user_id !== dbUser.id) {
    return NextResponse.json({ error: "无权操作该消息" }, { status: 404 });
  }

  const { error: updErr } = await db
    .from("messages")
    .update({ aborted: true })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
