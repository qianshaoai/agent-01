import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  // 总调用次数
  const { count: totalCalls } = await db
    .from("logs")
    .select("*", { count: "exact", head: true })
    .eq("action", "chat");

  // 成功次数
  const { count: successCalls } = await db
    .from("logs")
    .select("*", { count: "exact", head: true })
    .eq("action", "chat")
    .eq("status", "success");

  // 企业数
  const { count: totalTenants } = await db
    .from("tenants")
    .select("*", { count: "exact", head: true });

  // Top 智能体（统计调用量）
  const { data: topAgentRaw } = await db
    .from("logs")
    .select("agent_code, agent_name")
    .eq("action", "chat")
    .eq("status", "success");

  const agentCount: Record<string, { name: string; calls: number }> = {};
  for (const row of topAgentRaw ?? []) {
    if (!row.agent_code) continue;
    if (!agentCount[row.agent_code]) {
      agentCount[row.agent_code] = { name: row.agent_name ?? row.agent_code, calls: 0 };
    }
    agentCount[row.agent_code].calls++;
  }
  const topAgents = Object.entries(agentCount)
    .map(([code, v]) => ({ id: code, name: v.name, calls: v.calls }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5);

  // 企业使用量
  const { data: tenants } = await db
    .from("tenants")
    .select("code, name, quota, quota_used");

  return NextResponse.json({
    totalCalls: totalCalls ?? 0,
    successCalls: successCalls ?? 0,
    successRate:
      totalCalls && totalCalls > 0
        ? Math.round((successCalls! / totalCalls) * 1000) / 10
        : 100,
    totalTenants: totalTenants ?? 0,
    topAgents,
    tenantUsage: (tenants ?? []).map((t) => ({
      code: t.code,
      name: t.name,
      used: t.quota_used,
      quota: t.quota,
    })),
  });
}
