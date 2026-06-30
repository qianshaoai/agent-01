import { apiError, dbError, parsePagination } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { db } from "@/lib/db";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CenterSource = "builtin" | "external_api" | "external_link";
type CenterStatus = "published" | "draft" | "disabled";

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

type DraftRow = {
  id: string;
  name: string;
  description: string;
  category_ids: unknown;
  provider_id: string | null;
  agent_type: "chat" | "external";
  external_url: string;
  builder_config: Record<string, unknown>;
  status: "draft" | "testing" | "published" | "archived";
  published_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

type CategoryRow = {
  id: string;
  name: string;
  icon_url: string | null;
};

type CenterItem = {
  rowKind: "agent" | "draft";
  id: string;
  agentId: string | null;
  draftId: string | null;
  agentCode: string | null;
  name: string;
  description: string;
  source: CenterSource;
  status: CenterStatus;
  draftStatus: DraftRow["status"] | null;
  platform: string;
  externalUrl: string;
  categoryIds: string[];
  categories: { id: string; name: string; iconUrl: string | null }[];
  knowledgeBaseCount: number;
  workflowRefCount: number;
  conversationCount: number;
  updatedAt: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canEnable: boolean;
  canDelete: boolean;
};

type ProviderRow = { id: string; name: string; platform: string };

const CENTER_SCAN_LIMIT = 2000;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function sourceForAgent(agent: AgentRow): CenterSource {
  if (agent.agent_type === "external") return "external_link";
  if (agent.published_from_draft_id) return "builtin";
  return "external_api";
}

function sourceForDraft(draft: DraftRow): CenterSource {
  if (draft.agent_type === "external") return "external_link";
  return "builtin";
}

function inc(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countDistinctWorkflow(rows: { agent_id: string; workflow_id: string }[]) {
  const byAgent = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byAgent.get(row.agent_id) ?? new Set<string>();
    set.add(row.workflow_id);
    byAgent.set(row.agent_id, set);
  }
  const out = new Map<string, number>();
  for (const [agentId, set] of byAgent) out.set(agentId, set.size);
  return out;
}

function includesQuery(item: CenterItem, q: string) {
  if (!q) return true;
  const haystack = [
    item.name,
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

async function canReadDraft(ctx: Awaited<ReturnType<typeof requireAdminActor>>, id: string) {
  if (ctx instanceof Response) return false;
  if (ctx.role === "super_admin") return true;
  return !(await requireAccess(ctx.actor, "agent_draft", "read", { id }));
}

async function canWrite(
  ctx: Awaited<ReturnType<typeof requireAdminActor>>,
  resource: "agent" | "agent_draft",
  action: string,
  id: string,
) {
  if (ctx instanceof Response) return false;
  if (ctx.role === "super_admin") return true;
  return !(await requireAccess(ctx.actor, resource, action, { id }));
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

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
  if (status && !["published", "draft", "disabled"].includes(status)) {
    return apiError("智能体状态筛选值无效", "VALIDATION_ERROR");
  }

  const [agentsRes, draftsRes, categoriesRes] = await Promise.all([
    db
      .from("agents")
      .select(
        "id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, published_from_draft_id, created_by_role, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(CENTER_SCAN_LIMIT),
    db
      .from("agent_drafts")
      .select(
        "id, name, description, category_ids, provider_id, agent_type, external_url, builder_config, status, published_agent_id, created_at, updated_at",
      )
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(CENTER_SCAN_LIMIT),
    db.from("categories").select("id, name, icon_url").order("sort_order"),
  ]);

  if (agentsRes.error) return dbError(agentsRes.error, "获取智能体列表失败");
  if (draftsRes.error) return dbError(draftsRes.error, "获取智能体草稿失败");
  if (categoriesRes.error) return dbError(categoriesRes.error, "获取标签失败");

  const rawAgents = (agentsRes.data ?? []) as AgentRow[];
  const rawDrafts = (draftsRes.data ?? []) as DraftRow[];
  const categories = (categoriesRes.data ?? []) as CategoryRow[];

  const visibleAgents: AgentRow[] = [];
  for (const agent of rawAgents) {
    if (await canReadAgent(ctx, agent.id)) visibleAgents.push(agent);
  }

  const visibleDrafts: DraftRow[] = [];
  for (const draft of rawDrafts) {
    if (await canReadDraft(ctx, draft.id)) visibleDrafts.push(draft);
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const draftById = new Map(visibleDrafts.map((d) => [d.id, d]));
  const agentIds = visibleAgents.map((a) => a.id);
  const providerIds = [
    ...new Set(visibleDrafts.map((d) => d.provider_id).filter((id): id is string => !!id)),
  ];

  const [
    agentCategoryRes,
    kbRes,
    workflowRes,
    conversationRes,
    providersRes,
  ] = await Promise.all([
    agentIds.length
      ? db.from("agent_categories").select("agent_id, category_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("agent_knowledge_bases").select("agent_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("workflow_steps").select("agent_id, workflow_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    agentIds.length
      ? db.from("conversations").select("agent_id").in("agent_id", agentIds)
      : Promise.resolve({ data: [], error: null }),
    providerIds.length
      ? db.from("model_providers").select("id, name, platform").in("id", providerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (agentCategoryRes.error) return dbError(agentCategoryRes.error, "获取智能体标签失败");
  if (kbRes.error) return dbError(kbRes.error, "获取知识库引用失败");
  if (workflowRes.error) return dbError(workflowRes.error, "获取工作流引用失败");
  if (conversationRes.error) return dbError(conversationRes.error, "获取会话统计失败");
  if (providersRes.error) return dbError(providersRes.error, "获取供应商信息失败");

  const agentCatMap = new Map<string, string[]>();
  for (const row of (agentCategoryRes.data ?? []) as { agent_id: string; category_id: string }[]) {
    const arr = agentCatMap.get(row.agent_id) ?? [];
    arr.push(row.category_id);
    agentCatMap.set(row.agent_id, arr);
  }

  const kbCount = new Map<string, number>();
  for (const row of (kbRes.data ?? []) as { agent_id: string }[]) inc(kbCount, row.agent_id);

  const workflowCount = countDistinctWorkflow(
    (workflowRes.data ?? []) as { agent_id: string; workflow_id: string }[],
  );

  const conversationCount = new Map<string, number>();
  for (const row of (conversationRes.data ?? []) as { agent_id: string }[]) inc(conversationCount, row.agent_id);

  const providerMap = new Map(
    ((providersRes.data ?? []) as ProviderRow[]).map((p) => [p.id, p]),
  );

  const items: CenterItem[] = [];

  for (const agent of visibleAgents) {
    const categoryIds = agentCatMap.get(agent.id) ?? (agent.category_id ? [agent.category_id] : []);
    const cats = categoryIds
      .map((id) => categoryMap.get(id))
      .filter((c): c is CategoryRow => !!c)
      .map((c) => ({ id: c.id, name: c.name, iconUrl: c.icon_url }));
    const draft = agent.published_from_draft_id
      ? draftById.get(agent.published_from_draft_id)
      : null;

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
      knowledgeBaseCount: kbCount.get(agent.id) ?? 0,
      workflowRefCount: workflowCount.get(agent.id) ?? 0,
      conversationCount: conversationCount.get(agent.id) ?? 0,
      updatedAt: draft?.updated_at ?? agent.created_at,
      canEdit: false,
      canDuplicate: false,
      canEnable: false,
      canDelete: false,
    });
  }

  for (const draft of visibleDrafts) {
    // 已发布草稿在正式 agents 行中展示，避免中心列表重复出现同一个智能体。
    if (draft.status === "published" && draft.published_agent_id) continue;
    const categoryIds = toStringArray(draft.category_ids);
    const cats = categoryIds
      .map((id) => categoryMap.get(id))
      .filter((c): c is CategoryRow => !!c)
      .map((c) => ({ id: c.id, name: c.name, iconUrl: c.icon_url }));
    const provider = draft.provider_id ? providerMap.get(draft.provider_id) : null;
    const draftKbIds = toStringArray(draft.builder_config?.knowledge_base_ids);
    const publishedAgentId = draft.published_agent_id;

    items.push({
      rowKind: "draft",
      id: `draft:${draft.id}`,
      agentId: publishedAgentId,
      draftId: draft.id,
      agentCode: null,
      name: draft.name || "未命名智能体",
      description: draft.description,
      source: sourceForDraft(draft),
      status: "draft",
      draftStatus: draft.status,
      platform: draft.agent_type === "external" ? "external" : provider?.platform ?? "builder",
      externalUrl: draft.external_url,
      categoryIds,
      categories: cats,
      knowledgeBaseCount: publishedAgentId
        ? kbCount.get(publishedAgentId) ?? draftKbIds.length
        : draftKbIds.length,
      workflowRefCount: publishedAgentId ? workflowCount.get(publishedAgentId) ?? 0 : 0,
      conversationCount: publishedAgentId ? conversationCount.get(publishedAgentId) ?? 0 : 0,
      updatedAt: draft.updated_at,
      canEdit: false,
      canDuplicate: false,
      canEnable: false,
      canDelete: false,
    });
  }

  let filtered = items.filter((item) => includesQuery(item, q));
  if (source) filtered = filtered.filter((item) => item.source === source);
  if (platform) filtered = filtered.filter((item) => item.platform === platform);

  const categoryCounts = new Map<string, number>();
  for (const item of filtered) {
    for (const cid of item.categoryIds) inc(categoryCounts, cid);
  }

  if (categoryId) filtered = filtered.filter((item) => item.categoryIds.includes(categoryId));

  const statsBase = filtered;
  const stats = {
    total: statsBase.length,
    published: statsBase.filter((item) => item.status === "published").length,
    draft: statsBase.filter((item) => item.status === "draft").length,
    disabled: statsBase.filter((item) => item.status === "disabled").length,
    workflowReferenced: statsBase.filter((item) => item.workflowRefCount > 0).length,
  };

  if (status) filtered = filtered.filter((item) => item.status === status);

  filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const data: CenterItem[] = [];
  for (const item of pageItems) {
    if (item.rowKind === "agent" && item.agentId) {
      data.push({
        ...item,
        canEdit: await canWrite(ctx, "agent", "basic.update", item.agentId),
        canEnable: await canWrite(ctx, "agent", "enable", item.agentId),
        canDelete: await canWrite(ctx, "agent", "delete", item.agentId),
      });
      continue;
    }
    if (item.rowKind === "draft" && item.draftId) {
      data.push({
        ...item,
        canEdit: await canWrite(ctx, "agent_draft", "update", item.draftId),
        canDuplicate: await canWrite(ctx, "agent_draft", "duplicate", item.draftId),
        canDelete: await canWrite(ctx, "agent_draft", "delete", item.draftId),
      });
      continue;
    }
    data.push(item);
  }

  const platforms = [...new Set(items.map((item) => item.platform).filter(Boolean))].sort();

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
