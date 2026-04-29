import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

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
