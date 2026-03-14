import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

  // ── 1. 当前用户可访问的智能体 ID 集合 ────────────────────────────
  let accessibleIds: string[] = [];
  if (user.isPersonal) {
    const { data } = await db.from("agents").select("id").eq("enabled", true);
    accessibleIds = (data ?? []).map((a) => a.id);
  } else {
    const { data } = await db
      .from("tenant_agents")
      .select("agent_id")
      .eq("tenant_code", user.tenantCode);
    accessibleIds = (data ?? []).map((r) => r.agent_id);
  }

  // ── 2. 分类列表（始终返回）────────────────────────────────────────
  const { data: categories } = await db
    .from("categories")
    .select("id, name")
    .order("sort_order");

  // ── 3. 无 categoryId → 保持原有行为（全部可访问智能体）────────────
  if (!categoryId || categoryId === "__all__") {
    if (accessibleIds.length === 0) {
      return NextResponse.json({ categories: categories ?? [], agents: [] });
    }
    const { data: agents } = await db
      .from("agents")
      .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, categories!agents_category_id_fkey(name)")
      .in("id", accessibleIds)
      .eq("enabled", true);
    return NextResponse.json({ categories: categories ?? [], agents: agents ?? [] });
  }

  // ── 4. 指定 categoryId → 动态计算展示集合 ──────────────────────────
  if (accessibleIds.length === 0) {
    return NextResponse.json({ categories: categories ?? [], agents: [] });
  }

  // 4a. 获取该分类下的工作流 ID
  const { data: links } = await db
    .from("workflow_categories")
    .select("workflow_id")
    .eq("category_id", categoryId);

  const workflowIds = (links ?? []).map((l: { workflow_id: string }) => l.workflow_id);

  // 4b. 过滤用户可见工作流，取步骤中的智能体（自动同步集合）
  let autoAgentIds: string[] = [];
  if (workflowIds.length > 0) {
    const { data: wfs } = await db
      .from("workflows")
      .select("id, visible_to")
      .in("id", workflowIds)
      .eq("enabled", true);

    const tenantCode = user.tenantCode ?? "";
    const visibleWfIds = (wfs ?? [])
      .filter((wf) => {
        if (wf.visible_to === "all") return true;
        const allowed = wf.visible_to.split(",").map((s: string) => s.trim().toUpperCase());
        return allowed.includes(tenantCode.toUpperCase());
      })
      .map((wf) => wf.id);

    if (visibleWfIds.length > 0) {
      const { data: steps } = await db
        .from("workflow_steps")
        .select("agent_id")
        .in("workflow_id", visibleWfIds)
        .eq("enabled", true)
        .not("agent_id", "is", null);

      autoAgentIds = [
        ...new Set(
          (steps ?? []).map((s: { agent_id: string }) => s.agent_id).filter(Boolean)
        ),
      ];
    }
  }

  // 4c. 读取后台手工覆盖记录
  const { data: overrides } = await db
    .from("category_agent_display")
    .select("agent_id, is_manual, is_hidden")
    .eq("category_id", categoryId);

  const manualIds = (overrides ?? [])
    .filter((o: { is_manual: boolean }) => o.is_manual)
    .map((o: { agent_id: string }) => o.agent_id);

  const hiddenSet = new Set(
    (overrides ?? [])
      .filter((o: { is_hidden: boolean }) => o.is_hidden)
      .map((o: { agent_id: string }) => o.agent_id)
  );

  // 4d. 最终集合 = (自动同步 ∪ 手动添加) - 手动隐藏 ∩ 用户可访问
  const accessibleSet = new Set(accessibleIds);
  const finalIds = [
    ...new Set([...autoAgentIds, ...manualIds]),
  ].filter((id) => !hiddenSet.has(id) && accessibleSet.has(id));

  if (finalIds.length === 0) {
    return NextResponse.json({ categories: categories ?? [], agents: [] });
  }

  const { data: agents } = await db
    .from("agents")
    .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, categories!agents_category_id_fkey(name)")
    .in("id", finalIds)
    .eq("enabled", true);

  return NextResponse.json({ categories: categories ?? [], agents: agents ?? [] });
}
