import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]
 * 返回单个 agent 的展示元数据（脱敏，无 api_key），用于聊天页 header 显示。
 * 仅要求用户已登录，不做可见性过滤——
 * 因为聊天页直链场景下 agent 可能尚未通过工作流/权限暴露给当前用户，
 * 但用户已经能 POST chat（chat 路由仅按 agent_code 查），所以聊天页也应能看到名字。
 *
 * [id] 这里实际是 agent_code（与 /api/agents/[id]/chat 一致）。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id: rawId } = await params;
  const agentCode = decodeURIComponent(rawId);

  const { data: agent, error } = await db
    .from("agents")
    .select("agent_code, name, description, agent_type, external_url, enabled")
    .eq("agent_code", agentCode)
    .maybeSingle();

  if (error || !agent || !agent.enabled) {
    return NextResponse.json({ error: "智能体不存在或已禁用" }, { status: 404 });
  }

  return NextResponse.json({
    agent_code: agent.agent_code,
    name: agent.name,
    description: agent.description ?? "",
    agent_type: agent.agent_type ?? "chat",
    external_url: agent.external_url ?? "",
  });
}
