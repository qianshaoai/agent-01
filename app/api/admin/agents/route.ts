import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { parseBody } from "@/lib/validate";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireAccess } from "@/lib/access-facade";
import { mapResourcePermissionRowsToScopes } from "@/lib/adapters/access/_scope-utils";
import { actorHierarchyRole } from "@/lib/creator-hierarchy";
import { resolveAgentDraftOwnerScopesMap } from "@/lib/admin-scope-resolvers";

const createAgentSchema = z.object({
  agentCode: z.string().min(1, "请填写智能体编号"),
  name: z.string().min(1, "请填写名称"),
  platform: z.string().min(1, "请选择平台"),
  description: z.string().optional().default(""),
  agentType: z.enum(["chat", "external"]).optional().default("chat"),
  externalUrl: z.string().optional().default(""),
  apiEndpoint: z.string().optional().default(""),
  apiKey: z.string().optional().default(""),
  providerId: z.string().optional().default(""),
  modelParams: z.record(z.string(), z.unknown()).optional().default({}),
  categoryIds: z.array(z.string()).optional().default([]),
  categoryId: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { page, pageSize, start } = parsePagination(req, 50);
  const [agentsRes, rpRes, acRes, catRes] = await Promise.all([
    db.from("agents")
      .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, api_endpoint, api_key_enc, model_params, provider_id, published_from_draft_id, created_by_role", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1),
    db.from("resource_permissions").select("resource_id, scope_type, scope_id").eq("resource_type", "agent"),
    db.from("agent_categories").select("agent_id, category_id"),
    db.from("categories").select("id, name, icon_url"),
  ]);

  let agents = agentsRes.data ?? [];
  const permMap = new Map<string, { scope_type: string; scope_id: string | null }[]>();
  for (const rp of (rpRes.data ?? [])) {
    const arr = permMap.get(rp.resource_id) ?? [];
    arr.push({ scope_type: rp.scope_type, scope_id: rp.scope_id });
    permMap.set(rp.resource_id, arr);
  }
  const fallbackDraftScopeMap = await resolveAgentDraftOwnerScopesMap(
    agents
      .filter((agent) => (permMap.get(agent.id) ?? []).length === 0)
      .map((agent) => agent.published_from_draft_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  if (ctx.role !== "super_admin") {
    const visible = [];
    for (const agent of agents) {
      const rawPerms = permMap.get(agent.id) ?? [];
      let scopes = mapResourcePermissionRowsToScopes(rawPerms);
      if (rawPerms.length === 0 && agent.published_from_draft_id) {
        scopes = fallbackDraftScopeMap.get(agent.published_from_draft_id) ?? scopes;
      }
      const err = await requireAccess(ctx.actor, "agent", "read", {
        row: { id: agent.id, scopes },
      });
      if (!err) visible.push(agent);
    }
    agents = visible;
  }

  const catMap = new Map<string, { id: string; name: string; icon_url: string | null }>();
  for (const c of (catRes.data ?? []) as { id: string; name: string; icon_url: string | null }[]) {
    catMap.set(c.id, c);
  }
  const agentCatMap = new Map<string, string[]>();
  for (const row of (acRes.data ?? []) as { agent_id: string; category_id: string }[]) {
    const arr = agentCatMap.get(row.agent_id) ?? [];
    arr.push(row.category_id);
    agentCatMap.set(row.agent_id, arr);
  }

  // 4.29up：拉当前页 agent 引用的工作流（仅当前页范围，避免全表扫）
  const pageAgentIds = agents.map((a) => a.id);
  const wfMap = new Map<string, { id: string; name: string }[]>();
  if (pageAgentIds.length > 0) {
    const { data: wfRefs, error: wfErr } = await db
      .from("workflow_steps")
      .select("agent_id, workflows(id, name)")
      .in("agent_id", pageAgentIds);
    // 工作流引用查询失败时不静默：交由 dbError 处理，避免"未被引用"误判
    if (wfErr) return dbError(wfErr);
    type WfRef = { agent_id: string; workflows: { id: string; name: string } | null };
    for (const r of (wfRefs ?? []) as unknown as WfRef[]) {
      const wf = r.workflows;
      if (!wf?.id) continue;
      const arr = wfMap.get(r.agent_id) ?? [];
      // 同 agent 在同 workflow 多 step 时只保留 1 条
      if (!arr.find((x) => x.id === wf.id)) {
        arr.push({ id: wf.id, name: wf.name });
      }
      wfMap.set(r.agent_id, arr);
    }
  }

  // 5.15up PR-2 · 批量取 agent 绑定的命名 API（provider）展示信息
  const providerIds = [
    ...new Set(agents.map((a) => a.provider_id).filter(Boolean)),
  ] as string[];
  const providerMap = new Map<
    string,
    { name: string; category: string; platform: string; enabled: boolean }
  >();
  if (providerIds.length > 0) {
    const { data: provs } = await db
      .from("model_providers")
      .select("id, name, category, platform, enabled")
      .in("id", providerIds);
    for (const p of (provs ?? []) as {
      id: string; name: string; category: string; platform: string; enabled: boolean;
    }[]) {
      providerMap.set(p.id, { name: p.name, category: p.category, platform: p.platform, enabled: p.enabled });
    }
  }

  const masked = agents.map((a) => {
    const categoryIds = agentCatMap.get(a.id) ?? [];
    const cats = categoryIds.map((cid) => catMap.get(cid)).filter(Boolean) as { id: string; name: string; icon_url: string | null }[];
    const primaryCategory = cats[0] ?? (a.category_id ? catMap.get(a.category_id) : null);
    return {
      ...a,
      api_key_masked: a.api_key_enc ? "••••••••••••" + a.api_key_enc.slice(-4) : "",
      api_key_enc: undefined,
      // 绑定的命名 API（null = 未绑定，走旧 api_key_enc）
      provider: a.provider_id ? (providerMap.get(a.provider_id) ?? null) : null,
      permissions: permMap.get(a.id) ?? [],
      tenant_codes: (permMap.get(a.id) ?? []).filter(p => p.scope_type === "org").map(p => p.scope_id as string),
      categoryIds,
      categories: primaryCategory ? { name: primaryCategory.name, icon_url: primaryCategory.icon_url } : null,
      categoriesAll: cats,
      workflows: wfMap.get(a.id) ?? [],
    };
  });

  return paginatedResponse(
    masked,
    ctx.role === "super_admin" ? (agentsRes.count ?? 0) : masked.length,
    page,
    pageSize,
  );
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  // 5.7up · org_admin 只读，禁止创建智能体
  if (ctx.role === "org_admin" || ctx.isCustomAdmin) {
    return apiError("无权创建智能体", "FORBIDDEN");
  }

  const body = await parseBody(req, createAgentSchema);
  if (body instanceof Response) return body;

  const { agentCode, name, description, platform, agentType, externalUrl, apiEndpoint, apiKey, providerId, modelParams } = body;
  const catIds = body.categoryIds.length > 0 ? body.categoryIds : (body.categoryId ? [body.categoryId] : []);
  const primaryCat = catIds[0] ?? null;
  let providerIdToSave: string | null = null;

  if (providerId) {
    const wantCategory = ["coze", "dify", "yuanqi", "qingyan"].includes(platform) ? "agent" : "model";
    const { data: provider, error: providerErr } = await db
      .from("model_providers")
      .select("enabled, category")
      .eq("id", providerId)
      .maybeSingle();
    if (providerErr) return dbError(providerErr);
    if (!provider) return apiError("选择的命名 API 不存在", "VALIDATION_ERROR");
    if (!provider.enabled) return apiError("选择的命名 API 已禁用，请先在 API 管理里启用", "VALIDATION_ERROR");
    if (provider.category !== wantCategory) {
      return apiError(
        `该智能体应绑定${wantCategory === "agent" ? "智能体 API" : "大模型 API"}`,
        "VALIDATION_ERROR"
      );
    }
    providerIdToSave = providerId;
  }

  const { data, error } = await db
    .from("agents")
    .insert({
      agent_code: agentCode.toUpperCase(),
      name,
      description: description ?? "",
      category_id: primaryCat,
      platform,
      agent_type: agentType ?? "chat",
      external_url: externalUrl ?? "",
      api_endpoint: apiEndpoint ?? "",
      api_key_enc: apiKey ? encrypt(apiKey) : "",
      provider_id: providerIdToSave,
      model_params: modelParams ?? {},
      created_by_role: actorHierarchyRole(ctx.actor, "agent"),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError("智能体编号已存在", "CONFLICT");
    }
    return dbError(error);
  }

  if (catIds.length > 0) {
    await db.from("agent_categories").insert(catIds.map((cid) => ({ agent_id: data.id, category_id: cid })));
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "create",
    resourceType: "agent",
    resourceId: data.id,
    resourceName: name,
    detail: { agent_code: agentCode, platform },
  });

  return NextResponse.json(data, { status: 201 });
}
