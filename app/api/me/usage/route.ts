import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, requireFullUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// 5.12up · 当前用户的用量统计
// 口径（已通过 SQL 核对）：action='chat' AND status='success'
//   - trial_chat / upload / admin_* 都不算
//   - error / aborted 不算（aborted 实际被 CHECK 约束拦掉根本进不了 DB）
//
// 返回：
//   {
//     isPersonal: boolean,
//     quota: { orgUsed, orgTotal, myTotal, expiresAt },
//     counts: { today, thisWeek, thisMonth },
//     topAgents: [{ agentCode, agentName, count }],
//   }
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  // 1. 公司配额（个人用户跳过）
  let orgUsed = 0;
  let orgTotal = 0;
  let expiresAt: string | null = null;
  if (!user.isPersonal && user.tenantCode) {
    const { data: t } = await db
      .from("tenants")
      .select("quota, quota_used, expires_at")
      .eq("code", user.tenantCode)
      .single();
    if (t) {
      orgUsed = t.quota_used ?? 0;
      orgTotal = t.quota ?? 0;
      expiresAt = t.expires_at ?? null;
    }
  }

  // 2. 时间窗（local 计算，toISOString() 自动转 UTC，logs.created_at 也是 UTC）
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = (now.getDay() + 6) % 7; // 周一 = 0
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 3. 并发：4 个 head-only count + 1 个本月明细（topAgents）
  const phone = user.phone;
  const countQuery = () =>
    db.from("logs")
      .select("id", { count: "exact", head: true })
      .eq("user_phone", phone)
      .eq("action", "chat")
      .eq("status", "success");

  const [todayRes, weekRes, monthRes, totalRes, monthLogsRes] = await Promise.all([
    countQuery().gte("created_at", today.toISOString()),
    countQuery().gte("created_at", monday.toISOString()),
    countQuery().gte("created_at", monthStart.toISOString()),
    countQuery(),
    db.from("logs")
      .select("agent_code, agent_name")
      .eq("user_phone", phone)
      .eq("action", "chat")
      .eq("status", "success")
      .gte("created_at", monthStart.toISOString())
      .limit(2000),
  ]);

  // 4. 本月 top3 — JS group by（Supabase JS 不支持 GROUP BY）
  //    单用户单月通常 < 500 条，2000 上限足够；超出场景见方案 §九
  type LogRow = { agent_code: string | null; agent_name: string | null };
  const agentMap = new Map<string, { agentCode: string; agentName: string; count: number }>();
  for (const row of (monthLogsRes.data ?? []) as LogRow[]) {
    const key = row.agent_code ?? "(unknown)";
    const cur = agentMap.get(key) ?? {
      agentCode: key,
      agentName: row.agent_name ?? key,
      count: 0,
    };
    cur.count += 1;
    agentMap.set(key, cur);
  }
  const topAgents = [...agentMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return NextResponse.json({
    isPersonal: user.isPersonal,
    quota: {
      orgUsed,
      orgTotal,
      myTotal: totalRes.count ?? 0,
      expiresAt,
    },
    counts: {
      today: todayRes.count ?? 0,
      thisWeek: weekRes.count ?? 0,
      thisMonth: monthRes.count ?? 0,
    },
    topAgents,
  });
}
