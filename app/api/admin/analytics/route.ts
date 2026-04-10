import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权或权限已变更" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const tenantFilter = searchParams.get("tenantCode") ?? "";
  const deptFilter = searchParams.get("deptId") ?? "";
  const teamFilter = searchParams.get("teamId") ?? "";
  const userSearch = searchParams.get("userSearch") ?? "";
  const days = parseInt(searchParams.get("days") ?? "30");

  // 组织管理员强制只能看自己组织
  const scopedTenant = admin.role === "org_admin" ? admin.tenantCode ?? "" : tenantFilter;

  const sinceIso = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;

  // 构造一个带时间/租户/action=chat 过滤的 select builder
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function baseLogs(selectExpr: string, options?: { count?: "exact"; head?: boolean }): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from("logs").select(selectExpr, options ?? {}).eq("action", "chat");
    if (scopedTenant) q = q.eq("tenant_code", scopedTenant);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  }

  const [
    { count: totalCalls },
    { count: successCalls },
    { count: totalTenants },
    { data: topAgentRaw },
    { data: tenants },
    { data: allLogs },
  ] = await Promise.all([
    baseLogs("*", { count: "exact", head: true }),
    baseLogs("*", { count: "exact", head: true }).eq("status", "success"),
    admin.role === "org_admin"
      ? Promise.resolve({ count: 1 })
      : db.from("tenants").select("*", { count: "exact", head: true }),
    baseLogs("agent_code, agent_name").eq("status", "success"),
    admin.role === "org_admin"
      ? db.from("tenants").select("code, name, quota, quota_used").eq("code", scopedTenant)
      : db.from("tenants").select("code, name, quota, quota_used"),
    baseLogs("user_phone, tenant_code, agent_code, agent_name, created_at"),
  ]);

  // Top agents
  const agentCount: Record<string, { name: string; calls: number }> = {};
  for (const row of (topAgentRaw ?? []) as { agent_code: string | null; agent_name: string | null }[]) {
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

  // 用户维度聚合（key = phone + tenant，因为 logs 只有 phone）
  type UsageRow = {
    user_phone: string | null;
    tenant_code: string | null;
    agent_code: string | null;
    agent_name: string | null;
    created_at: string;
  };
  const userAgg: Record<
    string,
    {
      phone: string;
      tenantCode: string | null;
      calls: number;
      lastUsed: string;
      agentsMap: Record<string, { name: string; calls: number }>;
    }
  > = {};

  for (const l of ((allLogs ?? []) as UsageRow[])) {
    const phone = l.user_phone || "unknown";
    const key = `${phone}__${l.tenant_code ?? ""}`;
    if (!userAgg[key]) {
      userAgg[key] = {
        phone,
        tenantCode: l.tenant_code,
        calls: 0,
        lastUsed: l.created_at,
        agentsMap: {},
      };
    }
    const agg = userAgg[key];
    agg.calls++;
    if (l.created_at > agg.lastUsed) agg.lastUsed = l.created_at;
    if (l.agent_code) {
      if (!agg.agentsMap[l.agent_code]) {
        agg.agentsMap[l.agent_code] = { name: l.agent_name ?? l.agent_code, calls: 0 };
      }
      agg.agentsMap[l.agent_code].calls++;
    }
  }

  // 查询 users 表丰富展示信息（real_name / username / dept / team）
  const phones = [...new Set(Object.values(userAgg).map(u => u.phone).filter(p => p !== "unknown"))];
  const userInfoMap: Record<
    string,
    { id: string; real_name: string | null; username: string | null; dept_id: string | null; team_id: string | null; dept_name: string | null; team_name: string | null }
  > = {};
  if (phones.length > 0) {
    const { data: userRows } = await db
      .from("users")
      .select("id, phone, tenant_code, real_name, username, dept_id, team_id, departments(name), teams(name)")
      .in("phone", phones);
    for (const u of ((userRows ?? []) as unknown[]) as Array<{
      id: string;
      phone: string;
      tenant_code: string;
      real_name: string | null;
      username: string | null;
      dept_id: string | null;
      team_id: string | null;
      departments?: { name: string } | { name: string }[] | null;
      teams?: { name: string } | { name: string }[] | null;
    }>) {
      const deptName = Array.isArray(u.departments) ? u.departments[0]?.name : u.departments?.name;
      const teamName = Array.isArray(u.teams) ? u.teams[0]?.name : u.teams?.name;
      userInfoMap[`${u.phone}__${u.tenant_code ?? ""}`] = {
        id: u.id,
        real_name: u.real_name,
        username: u.username,
        dept_id: u.dept_id,
        team_id: u.team_id,
        dept_name: deptName ?? null,
        team_name: teamName ?? null,
      };
    }
  }

  let userUsage = Object.entries(userAgg).map(([key, u]) => {
    const info = userInfoMap[key];
    const topA = Object.entries(u.agentsMap)
      .map(([code, v]) => ({ code, name: v.name, calls: v.calls }))
      .sort((a, b) => b.calls - a.calls)[0] ?? null;
    return {
      userId: info?.id ?? null,
      phone: u.phone,
      tenantCode: u.tenantCode,
      realName: info?.real_name ?? null,
      username: info?.username ?? null,
      deptId: info?.dept_id ?? null,
      teamId: info?.team_id ?? null,
      deptName: info?.dept_name ?? null,
      teamName: info?.team_name ?? null,
      calls: u.calls,
      lastUsed: u.lastUsed,
      topAgent: topA,
    };
  });

  // 筛选：部门 / 小组 / 用户搜索
  if (deptFilter) userUsage = userUsage.filter((u) => u.deptId === deptFilter);
  if (teamFilter) userUsage = userUsage.filter((u) => u.teamId === teamFilter);
  if (userSearch) {
    const q = userSearch.toLowerCase();
    userUsage = userUsage.filter(
      (u) =>
        u.phone.toLowerCase().includes(q) ||
        (u.realName ?? "").toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q)
    );
  }

  userUsage.sort((a, b) => b.calls - a.calls);

  return NextResponse.json({
    totalCalls: totalCalls ?? 0,
    successCalls: successCalls ?? 0,
    successRate:
      totalCalls && totalCalls > 0
        ? Math.round(((successCalls ?? 0) / totalCalls) * 1000) / 10
        : 100,
    totalTenants: totalTenants ?? 0,
    topAgents,
    tenantUsage: ((tenants ?? []) as { code: string; name: string; quota: number; quota_used: number }[]).map((t) => ({
      code: t.code,
      name: t.name,
      used: t.quota_used,
      quota: t.quota,
    })),
    userUsage,
  });
}
