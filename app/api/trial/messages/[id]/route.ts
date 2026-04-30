import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/trial/messages/[id]?from=true
 *
 * 4.30 批次3：删除该消息及之后所有消息（用于"编辑 / 重新生成"）。
 * 鉴权链路：trial_messages → chat_id → trial_conversations.user_id 必须等于当前用户。
 *
 * **不带 from=true 直接 400**（本轮只支持"该条及之后"，不预留单条删除）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  const userId = payload!.type === "user" ? payload!.userId : "";
  if (!userId) return NextResponse.json({ error: "无效会话" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });

  const url = new URL(req.url);
  if (url.searchParams.get("from") !== "true") {
    return NextResponse.json(
      { error: "本接口仅支持 ?from=true（删除该消息及之后所有）" },
      { status: 400 }
    );
  }

  // 1) 查这条消息：拿 chat_id 和 created_at
  const { data: msgRow } = await db
    .from("trial_messages")
    .select("id, chat_id, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!msgRow) {
    return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  }

  // 2) 鉴权：通过 chat_id → trial_conversations.user_id 必须 = 当前用户
  const { data: convRow } = await db
    .from("trial_conversations")
    .select("user_id")
    .eq("id", msgRow.chat_id)
    .maybeSingle();

  if (!convRow || convRow.user_id !== userId) {
    return NextResponse.json({ error: "无权删除该消息" }, { status: 404 });
  }

  // 3) 删除该消息 + 之后所有消息（同一 chat 里 created_at >= 该消息的）
  const { error, count } = await db
    .from("trial_messages")
    .delete({ count: "exact" })
    .eq("chat_id", msgRow.chat_id)
    .gte("created_at", msgRow.created_at);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
