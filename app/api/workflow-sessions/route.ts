import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET: 列出当前用户的工作流会话（默认只返回 in_progress）
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const status = req.nextUrl.searchParams.get("status") ?? "in_progress";

  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();

  if (!dbUser) return NextResponse.json([], { status: 200 });

  const { data, error } = await db
    .from("workflow_sessions")
    .select(`
      id, name, current_step_idx, status, created_at, updated_at,
      workflows:workflow_id ( id, name, description )
    `)
    .eq("user_id", dbUser.id)
    .eq("status", status)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type WfJoin = { id: string; name: string; description: string } | null;

  // 附加每个工作流的总步骤数
  const allWfIds = [...new Set(
    (data ?? [])
      .map((s) => (s.workflows as unknown as WfJoin)?.id)
      .filter(Boolean) as string[]
  )];
  const stepCounts: Record<string, number> = {};
  if (allWfIds.length > 0) {
    const { data: stepRows } = await db
      .from("workflow_steps")
      .select("workflow_id")
      .in("workflow_id", allWfIds)
      .eq("enabled", true);
    for (const row of stepRows ?? []) {
      stepCounts[row.workflow_id] = (stepCounts[row.workflow_id] ?? 0) + 1;
    }
  }

  const result = (data ?? []).map((s) => {
    const wf = s.workflows as unknown as WfJoin;
    return {
      id: s.id,
      name: s.name,
      currentStepIdx: s.current_step_idx,
      totalSteps: wf ? (stepCounts[wf.id] ?? 0) : 0,
      status: s.status,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      workflow: wf ? { id: wf.id, name: wf.name, description: wf.description } : null,
    };
  });

  return NextResponse.json(result);
}

// POST: 创建新工作流会话
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { workflowId, name } = await req.json();
  if (!workflowId) return NextResponse.json({ error: "workflowId 必填" }, { status: 400 });

  // 验证工作流存在且启用
  const { data: wf } = await db
    .from("workflows")
    .select("id, name")
    .eq("id", workflowId)
    .eq("enabled", true)
    .single();
  if (!wf) return NextResponse.json({ error: "工作流不存在" }, { status: 404 });

  const { data: dbUser } = await db
    .from("users")
    .select("id")
    .eq("phone", user.phone)
    .eq("tenant_code", user.tenantCode)
    .single();
  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const sessionName = name?.trim() || `${wf.name} · ${new Date().toLocaleDateString("zh-CN")}`;

  const { data: session, error } = await db
    .from("workflow_sessions")
    .insert({
      user_id: dbUser.id,
      workflow_id: workflowId,
      name: sessionName,
      current_step_idx: 0,
      status: "in_progress",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(session, { status: 201 });
}
