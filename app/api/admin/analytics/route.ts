import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const [
    { count: totalCalls },
    { count: successCalls },
    { count: totalTenants },
    { data: topAgentRaw },
    { data: tenants },
  ] = await Promise.all([
    db.from("logs").select("*", { count: "exact", head: true }).eq("action", "chat"),
    db.from("logs").select("*", { count: "exact", head: true }).eq("action", "chat").eq("status", "success"),
    db.from("tenants").select("*", { count: "exact", head: true }),
    db.from("logs").select("agent_code, agent_name").eq("action", "chat").eq("status", "success"),
    db.from("tenants").select("code, name, quota, quota_used"),
  ]);

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
