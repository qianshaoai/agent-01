import { apiError, dbError, parsePagination } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { db } from "@/lib/db";
import { requireAdminActor } from "@/lib/session";
import { hasPermission } from "@/lib/permission-actor";
import {
  markRequestAuth,
  markRequestBusiness,
  withRequestLog,
} from "@/lib/request-logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UNGROUPED_CATEGORY_ID = "__ungrouped__";

type CenterSource = "builtin" | "external_api" | "external_link";
type CenterStatus = "published" | "disabled";

type AgentRow = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
  agent_type: string;
  external_url: string;
  enabled: boolean;
  category_id: string | null;
  published_from_draft_id: string | null;
  created_by_role: string | null;
  created_at: string;
};

type CategoryRow = {
  id: string;
  name: string;
  icon_url: string | null;
};

type RefItem = {
  id: string;
  name: string;
};

type CenterItem = {
  rowKind: "agent";
  id: string;
  agentId: string;
  draftId: string | null;
  agentCode: string | null;
  name: string;
  description: string;
  source: CenterSource;
  status: CenterStatus;
  draftStatus: null;
  platform: string;
  externalUrl: string;
  categoryIds: string[];
  categories: { id: string; name: string; iconUrl: string | null }[];
  knowledgeBases: RefItem[];
  workflows: RefItem[];
  knowledgeBaseCount: number;
  workflowRefCount: number;
  conversationCount: number;
  updatedAt: string;
  canEdit: boolean;
  canEnable: boolean;
  canDelete: boolean;
};

const CENTER_SCAN_LIMIT = 2000;

function sourceForAgent(agent: AgentRow): CenterSource {
  if (agent.agent_type === "external") return "external_link";
  if (agent.published_from_draft_id) return "builtin";
  return "external_api";
}

function inc(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addUniqueRef(map: Map<string, RefItem[]>, agentId: string, ref: RefItem) {
  const arr = map.get(agentId) ?? [];
  if (!arr.find((item) => item.id === ref.id)) arr.push(ref);
  map.set(agentId, arr);
}

function includesQuery(item: CenterItem, q: string) {
  if (!q) return true;
  const haystack = [
    item.name,
    item.agentId,
    item.agentCode ?? "",
    item.description,
    item.platform,
    ...item.categories.map((c) => c.name),
  ].join(" ").toLowerCase();
  return haystack.includes(q.toLowerCase());
}

async function canReadAgent(ctx: Awaited<ReturnType<typeof requireAdminActor>>, id: string) {
  if (ctx instanceof Response) return false;
  if (ctx.role === "super_admin") return true;
  return !(await requireAccess(ctx.actor, "agent", "read", { id }));
}

async function canWrite(
  ctx: Awaited<ReturnType<typeof requireAdminActor>>,
  action: string,
  id: string,
) {
  if (ctx instanceof Response) return false;
  if (ctx.role === "super_admin") return true;
  return !(await requireAccess(ctx.actor, "agent", action, { id }));
}

async function getAgentCenter(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  markRequestAuth(req, { source: ctx.source, role: ctx.role });

  const { page, pageSize } = parsePagination(req, 10);
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const source = (sp.get("source") ?? "") as CenterSource | "";
  const status = (sp.get("status") ?? "") as CenterStatus | "";
  const categoryId = sp.get("categoryId") ?? "";
  const platform = (sp.get("platform") ?? "").trim();

  if (source && !["builtin", "external_api", "external_link"].includes(source)) {
    return apiError("智能体来源筛选值无效", "VALIDATION_ERROR");
  }
  if (status && !["published", "disabled"].includes(status)) {
    return apiError("智能体状态筛选值无效", "VALIDATION_ERROR");
  }

  if (process.env.ADMIN_AGENT_CENTER_V2 === "true") {
    const isSuper = ctx.role === "super_admin";
    const orgScope = ctx.tenantCode
      ? [{ scope_type: "org" as const, scope_id: ctx.tenantCode }]
      : [];
    const [
      canReadAll,
      canReadOrg,
      canUpdateAll,
      canUpdateOrg,
      canEnableAll,
      canEnableOrg,
      canDeleteAll,
      canDeleteOrg,
    ] = await Promise.all([
      isSuper ? true : hasPermission(ctx.actor, "agent.read.all"),
      isSuper || !ctx.tenantCode
        ? false
        : hasPermission(ctx.actor, "agent.read.org", orgScope),
      isSuper ? true : hasPermission(ctx.actor, "agent.basic.update.all"),
      isSuper || !ctx.tenantCode
        ? false
        : hasPermission(ctx.actor, "agent.basic.update.org", orgScope),
      isSuper ? true : hasPermission(ctx.actor, "agent.enable.all"),
      isSuper || !ctx.tenantCode
        ? false
        : hasPermission(ctx.actor, "agent.enable.org", orgScope),
      isSuper ? true : hasPermission(ctx.actor, "agent.delete.all"),
      isSuper || !ctx.tenantCode
        ? false
        : hasPermission(ctx.actor, "agent.delete.org", orgScope),
    ]);

    if (!canReadAll && !canReadOrg) {
      return apiError("权限不足", "FORBIDDEN");
    }

    const { data, error } = await db.rpc("admin_agent_center_page", {
      p_tenant_code: ctx.tenantCode,
      p_can_read_all: canReadAll,
      p_can_read_org: canReadOrg,
      p_can_update_all: canUpdateAll,
      p_can_update_org: canUpdateOrg,
      p_can_enable_all: canEnableAll,
      p_can_enable_org: canEnableOrg,
      p_can_delete_all: canDeleteAll,
      p_can_delete_org: canDeleteOrg,
      p_q: q || null,
      p_source: source || null,
      p_status: status || null,
      p_category_id: categoryId || null,
      p_platform: platform || null,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) {
      console.error("[admin agent center rpc]", error.code, error.message);
      return apiError("获取智能体中心数据失败", "INTERNAL_ERROR");
    }
    markRequestBusiness(req);
    return NextResponse.json(data ?? {
      data: [],
      pagination: { page, pageSize, total: 0 },
      stats: {
        total: 0,
        published: 0,
        disabled: 0,
        workflowReferenced: 0,
        ungrouped: 0,
      },
      categories: [],
      platforms: [],
    });
  }

  const [agentsRes, categoriesRes] = await Promise.all([
    db
      .from("agents")
      .select(
        "id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, published_from_draft_id, created_by_role, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(CENTER_SCAN_LIMIT),
    db.from("categories").select("id, name, icon_url").order("sort_order"),
  ]);

  if (agentsRes.error) return dbError(agentsRes.error, "获取智能体列表失败");
  if (categoriesRes.error) return dbError(categoriesRes.error, "获取标签失败");

  const rawAgents = (agentsRes.data ?? []) as AgentRow[];
  const categories = (categoriesRes.data ?? []) as CategoryRow[];

  const visibleAgents: AgentRow[] = [];
  for (const agent of rawAgents) {
    if (await canReadAgent(ctx, agent.id)) visibleAgents.push(agent);
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const agentIds = visibleAgents.map((a) => a.id);

  const [
    agentCategoryRes,
    kbRes,
    workflowRes,
    conversationRes,
  ] = await Promise.all([
    agentIds.length
      ? db.from("agent_categories").select("agent_id, category_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("agent_knowledge_bases").select("agent_id, kb_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("workflow_steps").select("agent_id, workflow_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("conversations").select("agent_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (agentCategoryRes.error) return dbError(agentCategoryRes.error, "获取智能体标签失败");
  if (kbRes.error) return dbError(kbRes.error, "获取知识库引用失败");
  if (workflowRes.error) return dbError(workflowRes.error, "获取工作流引用失败");
  if (conversationRes.error) return dbError(conversationRes.error, "获取会话统计失败");

  const agentCatMap = new Map<string, string[]>();
  for (const row of (agentCategoryRes.data ?? []) as { agent_id: string; category_id: string }[]) {
    const arr = agentCatMap.get(row.agent_id) ?? [];
    arr.push(row.category_id);
    agentCatMap.set(row.agent_id, arr);
  }

  const kbRows = (kbRes.data ?? []) as { agent_id: string; kb_id: string }[];
  const workflowRows = (workflowRes.data ?? []) as { agent_id: string; workflow_id: string }[];

  const kbIds = [...new Set(kbRows.map((row) => row.kb_id).filter(Boolean))];
  const workflowIds = [...new Set(workflowRows.map((row) => row.workflow_id).filter(Boolean))];
  const [kbNameRes, workflowNameRes] = await Promise.all([
    kbIds.length
      ? db.from("knowledge_bases").select("id, name").in("id", kbIds)
      : Promise.resolve({ data: [], error: null }),
    workflowIds.length
      ? db.from("workflows").select("id, name").in("id", workflowIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (kbNameRes.error) return dbError(kbNameRes.error, "获取知识库名称失败");
  if (workflowNameRes.error) return dbError(workflowNameRes.error, "获取工作流名称失败");

  const kbNameMap = new Map(
    ((kbNameRes.data ?? []) as RefItem[]).map((item) => [item.id, item.name]),
  );
  const workflowNameMap = new Map(
    ((workflowNameRes.data ?? []) as RefItem[]).map((item) => [item.id, item.name]),
  );

  const kbRefMap = new Map<string, RefItem[]>();
  for (const row of kbRows) {
    addUniqueRef(kbRefMap, row.agent_id, {
      id: row.kb_id,
      name: kbNameMap.get(row.kb_id) ?? `知识库 ${row.kb_id.slice(0, 8)}`,
    });
  }

  const workflowRefMap = new Map<string, RefItem[]>();
  for (const row of workflowRows) {
    addUniqueRef(workflowRefMap, row.agent_id, {
      id: row.workflow_id,
      name: workflowNameMap.get(row.workflow_id) ?? `工作流 ${row.workflow_id.slice(0, 8)}`,
    });
  }

  const conversationCount = new Map<string, number>();
  for (const row of (conversationRes.data ?? []) as { agent_id: string }[]) inc(conversationCount, row.agent_id);

  const items: CenterItem[] = [];

  for (const agent of visibleAgents) {
    const categoryIds = agentCatMap.get(agent.id) ?? (agent.category_id ? [agent.category_id] : []);
    const cats = categoryIds
      .map((id) => categoryMap.get(id))
      .filter((c): c is CategoryRow => !!c)
      .map((c) => ({ id: c.id, name: c.name, iconUrl: c.icon_url }));

    items.push({
      rowKind: "agent",
      id: `agent:${agent.id}`,
      agentId: agent.id,
      draftId: agent.published_from_draft_id,
      agentCode: agent.agent_code,
      name: agent.name,
      description: agent.description,
      source: sourceForAgent(agent),
      status: agent.enabled ? "published" : "disabled",
      draftStatus: null,
      platform: agent.platform,
      externalUrl: agent.external_url,
      categoryIds,
      categories: cats,
      knowledgeBases: kbRefMap.get(agent.id) ?? [],
      workflows: workflowRefMap.get(agent.id) ?? [],
      knowledgeBaseCount: kbRefMap.get(agent.id)?.length ?? 0,
      workflowRefCount: workflowRefMap.get(agent.id)?.length ?? 0,
      conversationCount: conversationCount.get(agent.id) ?? 0,
      updatedAt: agent.created_at,
      canEdit: false,
      canEnable: false,
      canDelete: false,
    });
  }

  let filtered = items.filter((item) => includesQuery(item, q));
  if (source) filtered = filtered.filter((item) => item.source === source);
  if (platform) filtered = filtered.filter((item) => item.platform === platform);

  const statsBase = filtered;
  const categoryCounts = new Map<string, number>();
  let ungroupedCount = 0;
  for (const item of statsBase) {
    if (item.categoryIds.length === 0) ungroupedCount += 1;
    for (const cid of item.categoryIds) inc(categoryCounts, cid);
  }

  if (categoryId === UNGROUPED_CATEGORY_ID) {
    filtered = filtered.filter((item) => item.categoryIds.length === 0);
  } else if (categoryId) {
    filtered = filtered.filter((item) => item.categoryIds.includes(categoryId));
  }

  const stats = {
    total: statsBase.length,
    published: statsBase.filter((item) => item.status === "published").length,
    disabled: statsBase.filter((item) => item.status === "disabled").length,
    workflowReferenced: statsBase.filter((item) => item.workflowRefCount > 0).length,
    ungrouped: ungroupedCount,
  };

  if (status) filtered = filtered.filter((item) => item.status === status);

  filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const data: CenterItem[] = [];
  for (const item of pageItems) {
    data.push({
      ...item,
      canEdit: await canWrite(ctx, "basic.update", item.agentId),
      canEnable: await canWrite(ctx, "enable", item.agentId),
      canDelete: await canWrite(ctx, "delete", item.agentId),
    });
  }

  const platforms = [...new Set(items.map((item) => item.platform).filter(Boolean))].sort();

  markRequestBusiness(req);
  return NextResponse.json({
    data,
    pagination: { page, pageSize, total },
    stats,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      iconUrl: c.icon_url,
      count: categoryCounts.get(c.id) ?? 0,
    })),
    platforms,
  });
}

export const GET = withRequestLog(getAgentCenter);
