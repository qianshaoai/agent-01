import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";
import { z } from "zod";

export const dynamic = "force-dynamic";

const TITLE_MAX = 60;

const patchSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(TITLE_MAX, `标题最多 ${TITLE_MAX} 字`),
});

/**
 * 鉴权链路：当前用户 → users.id → conversations.user_id 必须等于当前用户
 * 找不到 / 不属于当前用户 → 统一 404 ("会话不存在")
 */
async function authConversation(conversationId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { err: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  const guard = requireFullUser(user);
  if (guard) return { err: guard };

  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();
  if (!dbUser) {
    return { err: NextResponse.json({ error: "会话不存在" }, { status: 404 }) };
  }

  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", dbUser.id)
    .maybeSingle();
  if (!conv) {
    return { err: NextResponse.json({ error: "会话不存在" }, { status: 404 }) };
  }

  return { dbUser, conv };
}

/** PATCH /api/conversations/[id] — 仅允许改 title */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authConversation(id);
  if (auth.err) return auth.err;

  const body = await parseBody(req, patchSchema);
  if (body instanceof Response) return body;

  const { error } = await db
    .from("conversations")
    .update({ title: body.title, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/conversations/[id] — 级联删除消息（messages.conversation_id ON DELETE CASCADE） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authConversation(id);
  if (auth.err) return auth.err;

  const { error } = await db.from("conversations").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
