import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id: conversationId } = await params;

  // 验证会话属于当前用户
  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();

  if (!dbUser) return NextResponse.json([]);

  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", dbUser.id)
    .single();

  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  // 兜底：aborted 列是 migration_v22 才加的；如果生产库还没跑迁移，
  // 带 aborted 的 select 会报错（PGRST204 / 42703），回退到不带 aborted 的查询。
  let messages: unknown[] | null = null;
  const first = await db
    .from("messages")
    .select("id, role, content, created_at, aborted")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (first.error) {
    const fallback = await db
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    messages = fallback.data ?? [];
  } else {
    messages = first.data ?? [];
  }

  return NextResponse.json(messages);
}
