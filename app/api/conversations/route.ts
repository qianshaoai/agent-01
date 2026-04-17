import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePagination, paginatedResponse } from "@/lib/api-error";

// GET: 获取当前用户某智能体的所有会话
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { page, pageSize, start } = parsePagination(req, 50);
  const rawAgentCode = req.nextUrl.searchParams.get("agentCode");
  const agentCode = rawAgentCode ? decodeURIComponent(rawAgentCode) : null;

  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();

  if (!dbUser) return paginatedResponse([], 0, page, pageSize);

  let query = db
    .from("conversations")
    .select("id, title, created_at, updated_at, agents(agent_code, name)", { count: "exact" })
    .eq("user_id", dbUser.id)
    .order("updated_at", { ascending: false });

  if (agentCode) {
    const { data: agent } = await db
      .from("agents")
      .select("id")
      .eq("agent_code", agentCode)
      .single();
    if (agent) query = query.eq("agent_id", agent.id);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}
