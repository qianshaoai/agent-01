import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/trial/conversations?agent_id=xxx
 * 列出当前体验账号在某个智能体下的全部聊天记录，按最近活跃倒序。
 */
export async function GET(req: NextRequest) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  const userId = payload!.type === "user" ? payload!.userId : "";
  if (!userId) return NextResponse.json({ error: "无效会话" }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get("agent_id") ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "agent_id 必填" }, { status: 400 });
  }
  if (!getTrialAgentRaw(agentId)) {
    return NextResponse.json({ error: `trial agent not found: ${agentId}` }, { status: 404 });
  }

  const { data, error } = await db
    .from("trial_conversations")
    .select("id, title, last_active_at, created_at")
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("last_active_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ chats: data ?? [] });
}
