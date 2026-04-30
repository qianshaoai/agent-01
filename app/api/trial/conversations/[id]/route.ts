import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/trial/conversations/[id]
 * 4.30 批次2：仅允许改 title（其它字段一律拒绝）。
 * Body: { title: string }
 */
export async function PATCH(
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

  const body = await req.json().catch(() => null);
  const rawTitle = body?.title;
  if (typeof rawTitle !== "string") {
    return NextResponse.json({ error: "title 必填且为字符串" }, { status: 400 });
  }
  const title = rawTitle.trim();
  if (!title) {
    return NextResponse.json({ error: "title 不能为空" }, { status: 400 });
  }
  if (title.length > 60) {
    return NextResponse.json({ error: "title 长度不超过 60" }, { status: 400 });
  }

  const { error, count } = await db
    .from("trial_conversations")
    .update({ title }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: "聊天记录不存在或无权访问" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, title });
}

/**
 * DELETE /api/trial/conversations/[id]
 * 删除一条聊天记录（仅删 trial_conversations 行；Coze 那边的 conversation 不动）。
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

  const { error, count } = await db
    .from("trial_conversations")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId); // 防越权：只能删自己的

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json({ error: "聊天记录不存在或无权删除" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
