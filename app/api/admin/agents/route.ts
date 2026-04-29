import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { parseBody } from "@/lib/validate";
import { z } from "zod";

const createAgentSchema = z.object({
  agentCode: z.string().min(1, "请填写智能体编号"),
  name: z.string().min(1, "请填写名称"),
  platform: z.string().min(1, "请选择平台"),
  description: z.string().optional().default(""),
  agentType: z.enum(["chat", "external"]).optional().default("chat"),
  externalUrl: z.string().optional().default(""),
  apiEndpoint: z.string().optional().default(""),
  apiKey: z.string().optional().default(""),
  modelParams: z.record(z.string(), z.unknown()).optional().default({}),
  categoryIds: z.array(z.string()).optional().default([]),
  categoryId: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { page, pageSize, start } = parsePagination(req, 50);
  const [agentsRes, rpRes, acRes, catRes] = await Promise.all([
    db.from("agents")
      .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, api_endpoint, api_key_enc, model_params", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(start, start + pageSize - 1),
    db.from("resource_permissions").select("resource_id, scope_type, scope_id").eq("resource_type", "agent"),
    db.from("agent_categories").select("agent_id, category_id"),
    db.from("categories").select("id, name, icon_url"),
  ]);

  const agents = agentsRes.data ?? [];
  const permMap = new Map<string, { scope_type: string; scope_id: string | null }[]>();
  for (const rp of (rpRes.data ?? [])) {
    const arr = permMap.get(rp.resource_id) ?? [];
    arr.push({ scope_type: rp.scope_type, scope_id: rp.scope_id });
    permMap.set(rp.resource_id, arr);
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

  const masked = agents.map((a) => {
    const categoryIds = agentCatMap.get(a.id) ?? [];
    const cats = categoryIds.map((cid) => catMap.get(cid)).filter(Boolean) as { id: string; name: string; icon_url: string | null }[];
    const primaryCategory = cats[0] ?? (a.category_id ? catMap.get(a.category_id) : null);
    return {
      ...a,
      api_key_masked: a.api_key_enc ? "••••••••••••" + a.api_key_enc.slice(-4) : "",
      api_key_enc: undefined,
      permissions: permMap.get(a.id) ?? [],
      tenant_codes: (permMap.get(a.id) ?? []).filter(p => p.scope_type === "org").map(p => p.scope_id as string),
      categoryIds,
      categories: primaryCategory ? { name: primaryCategory.name, icon_url: primaryCategory.icon_url } : null,
      categoriesAll: cats,
      workflows: wfMap.get(a.id) ?? [],
    };
  });

  return paginatedResponse(masked, agentsRes.count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await parseBody(req, createAgentSchema);
  if (body instanceof Response) return body;

  const { agentCode, name, description, platform, agentType, externalUrl, apiEndpoint, apiKey, modelParams } = body;
  const catIds = body.categoryIds.length > 0 ? body.categoryIds : (body.categoryId ? [body.categoryId] : []);
  const primaryCat = catIds[0] ?? null;

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
      model_params: modelParams ?? {},
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

  return NextResponse.json(data, { status: 201 });
}
