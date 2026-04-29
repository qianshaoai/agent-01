import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

  // ── 0. 组织用户：获取 dept_id / team_id 用于细粒度权限匹配 ──────
  let userDeptId: string | null = null;
  let userTeamId: string | null = null;
  if (!user.isPersonal) {
    const { data: uRow } = await db.from("users").select("dept_id, team_id").eq("id", user.userId).single();
    userDeptId = uRow?.dept_id ?? null;
    userTeamId = uRow?.team_id ?? null;
  }

  // ── 1+2. 并行：可访问 ID 集合 + 分类列表 + 分类组织分配 ───────────
  const buildOrgAccessQuery = () => {
    const orParts = [
      "scope_type.eq.all",
      `and(scope_type.eq.user_type,scope_id.eq.organization)`,
      `and(scope_type.eq.org,scope_id.eq.${user.tenantCode})`,
      `and(scope_type.eq.user,scope_id.eq.${user.userId})`,
    ];
    if (userDeptId) orParts.push(`and(scope_type.eq.dept,scope_id.eq.${userDeptId})`);
    if (userTeamId) orParts.push(`and(scope_type.eq.team,scope_id.eq.${userTeamId})`);
    return db.from("resource_permissions").select("resource_id").eq("resource_type", "agent").or(orParts.join(","));
  };

  // 硬上限 1000 — 防止组织规模过大时一次拉取过量数据
  const [accessibleQuery, categoriesQuery, tcQuery] = await Promise.all([
    user.isPersonal
      ? db.from("agents").select("id").eq("enabled", true).limit(1000)
      : buildOrgAccessQuery(),
    db.from("categories").select("id, name, icon_url").order("sort_order"),
    user.isPersonal
      ? Promise.resolve({ data: [] as { category_id: string; tenant_code: string }[] })
      : db.from("tenant_categories").select("category_id, tenant_code"),
  ]);

  const accessibleIds: string[] = user.isPersonal
    ? ((accessibleQuery.data ?? []) as { id: string }[]).map((a) => a.id)
    : ((accessibleQuery.data ?? []) as { resource_id: string }[]).map((r) => r.resource_id);

  // 分类过滤：
  //   - 个人用户：始终看到全部分类
  //   - 组织用户：若 tenant_categories 里配置过本组织 → 按配置过滤；否则兜底显示全部（兼容旧数据）
  const allCategories = categoriesQuery.data ?? [];
  const tcData = (tcQuery.data ?? []) as { category_id: string; tenant_code: string }[];
  const hasAnyTenantConfig = tcData.some((r) => r.tenant_code === user.tenantCode);
  const allowedCatIds = new Set(tcData.filter((r) => r.tenant_code === user.tenantCode).map((r) => r.category_id));
  const categories = user.isPersonal
    ? allCategories
    : hasAnyTenantConfig
      ? allCategories.filter((cat) => allowedCatIds.has(cat.id))
      : allCategories;

  // ── 附加：为返回的智能体挂上 categoriesAll（多对多）────────────
  async function enrichWithCategories(agentList: Array<{ id: string; category_id?: string | null; [k: string]: unknown }>) {
    if (agentList.length === 0) return agentList;
    const ids = agentList.map((a) => a.id);
    const { data: acRows } = await db
      .from("agent_categories")
      .select("agent_id, category_id")
      .in("agent_id", ids);
    const catMap = new Map<string, { id: string; name: string; icon_url: string | null }>();
    for (const c of (allCategories ?? []) as { id: string; name: string; icon_url: string | null }[]) {
      catMap.set(c.id, c);
    }
    const agentCatMap = new Map<string, string[]>();
    for (const row of ((acRows ?? []) as { agent_id: string; category_id: string }[])) {
      const arr = agentCatMap.get(row.agent_id) ?? [];
      arr.push(row.category_id);
      agentCatMap.set(row.agent_id, arr);
    }
    return agentList.map((a) => {
      const cids = agentCatMap.get(a.id) ?? [];
      const catsAll = cids.map((cid) => catMap.get(cid)).filter(Boolean) as { id: string; name: string; icon_url: string | null }[];
      // 如果连接表里没有，回退到旧字段 category_id
      const fallback: { id: string; name: string; icon_url: string | null } | undefined = a.category_id ? catMap.get(a.category_id) : undefined;
      const finalCats = catsAll.length > 0 ? catsAll : (fallback ? [fallback] : []);
      return {
        ...a,
        categoriesAll: finalCats,
        // 兼容旧 .categories.name 读取方式
        categories: finalCats[0] ? { name: finalCats[0].name, icon_url: finalCats[0].icon_url } : null,
      };
    });
  }

  // ── 3. 无 categoryId → 保持原有行为（全部可访问智能体）────────────
  if (!categoryId || categoryId === "__all__") {
    if (accessibleIds.length === 0) {
      return NextResponse.json({ categories: categories ?? [], agents: [] });
    }
    const { data: agents } = await db
      .from("agents")
      .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id")
      .in("id", accessibleIds)
      .eq("enabled", true)
      .limit(1000);
    const enriched = await enrichWithCategories(agents ?? []);
    return NextResponse.json({ categories: categories ?? [], agents: enriched });
  }

  // ── 4. 指定 categoryId → 动态计算展示集合 ──────────────────────────
  if (accessibleIds.length === 0) {
    return NextResponse.json({ categories: categories ?? [], agents: [] });
  }

  // 4a. 并行：工作流分类关联 + 手工覆盖 + 多对多直接关联（互不依赖）
  const [{ data: links }, { data: overrides }, { data: directLinks }] = await Promise.all([
    db.from("workflow_categories").select("workflow_id").eq("category_id", categoryId),
    db.from("category_agent_display").select("agent_id, is_manual, is_hidden").eq("category_id", categoryId),
    db.from("agent_categories").select("agent_id").eq("category_id", categoryId),
  ]);

  const workflowIds = (links ?? []).map((l: { workflow_id: string }) => l.workflow_id);
  const manualIds = (overrides ?? [])
    .filter((o: { is_manual: boolean }) => o.is_manual)
    .map((o: { agent_id: string }) => o.agent_id);
  const directIds = (directLinks ?? []).map((l: { agent_id: string }) => l.agent_id);

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

  const hiddenSet = new Set(
    (overrides ?? [])
      .filter((o: { is_hidden: boolean }) => o.is_hidden)
      .map((o: { agent_id: string }) => o.agent_id)
  );

  // 4d. 最终集合 = (自动同步 ∪ 手动添加) - 手动隐藏 ∩ 用户可访问
  // 注：工作流步骤中绑定的外链型智能体（external）不受租户权限表限制，
  //     管理员将其加入工作流步骤即视为对该分类用户授权访问。
  const accessibleSet = new Set(accessibleIds);

  // 查询 autoAgentIds 中属于外链类型的智能体（仅需 id）
  let externalAutoSet = new Set<string>();
  if (autoAgentIds.length > 0) {
    const { data: extAgents } = await db
      .from("agents")
      .select("id")
      .in("id", autoAgentIds)
      .eq("agent_type", "external")
      .eq("enabled", true);
    externalAutoSet = new Set((extAgents ?? []).map((a: { id: string }) => a.id));
  }

  const finalIds = [
    ...new Set([...autoAgentIds, ...manualIds, ...directIds]),
  ].filter((id) => !hiddenSet.has(id) && (accessibleSet.has(id) || externalAutoSet.has(id)));

  if (finalIds.length === 0) {
    return NextResponse.json({ categories: categories ?? [], agents: [] });
  }

  const { data: agents } = await db
    .from("agents")
    .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id")
    .in("id", finalIds)
    .eq("enabled", true);

  const enriched = await enrichWithCategories(agents ?? []);
  return NextResponse.json({ categories: categories ?? [], agents: enriched });
}
