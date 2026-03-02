import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let agentIds: string[] = [];

  if (user.isPersonal) {
    // 个人用户：显示所有启用智能体
    const { data } = await db
      .from("agents")
      .select("id")
      .eq("enabled", true);
    agentIds = (data ?? []).map((a) => a.id);
  } else {
    // 企业用户：显示分配给该企业的智能体
    const { data } = await db
      .from("tenant_agents")
      .select("agent_id")
      .eq("tenant_code", user.tenantCode);
    agentIds = (data ?? []).map((r) => r.agent_id);
  }

  if (agentIds.length === 0) {
    return NextResponse.json({ categories: [], agents: [] });
  }

  // 获取智能体详情（不返回 API 配置）
  const { data: agents } = await db
    .from("agents")
    .select("id, agent_code, name, description, platform, enabled, category_id, categories(name)")
    .in("id", agentIds)
    .eq("enabled", true);

  // 获取分类
  const { data: categories } = await db
    .from("categories")
    .select("id, name")
    .order("sort_order");

  return NextResponse.json({ categories: categories ?? [], agents: agents ?? [] });
}
