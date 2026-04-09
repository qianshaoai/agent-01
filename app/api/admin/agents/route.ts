import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  // 拆分为两次独立查询，避免 PostgREST 因多个外键指向 agents 产生嵌套关系歧义
  const [agentsRes, rpRes] = await Promise.all([
    db.from("agents")
      .select("id, agent_code, name, description, platform, agent_type, external_url, enabled, category_id, categories!agents_category_id_fkey(name), api_endpoint, api_key_enc, model_params")
      .order("created_at", { ascending: false }),
    db.from("resource_permissions").select("resource_id, scope_type, scope_id").eq("resource_type", "agent"),
  ]);

  const agents = agentsRes.data ?? [];
  const permMap = new Map<string, { scope_type: string; scope_id: string | null }[]>();
  for (const rp of (rpRes.data ?? [])) {
    const arr = permMap.get(rp.resource_id) ?? [];
    arr.push({ scope_type: rp.scope_type, scope_id: rp.scope_id });
    permMap.set(rp.resource_id, arr);
  }

  const masked = agents.map((a) => ({
    ...a,
    api_key_masked: a.api_key_enc ? "••••••••••••" + a.api_key_enc.slice(-4) : "",
    api_key_enc: undefined,
    permissions: permMap.get(a.id) ?? [],
    // Keep tenant_codes for backward compat
    tenant_codes: (permMap.get(a.id) ?? []).filter(p => p.scope_type === "org").map(p => p.scope_id as string),
  }));

  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { agentCode, name, description, categoryId, platform, agentType, externalUrl, apiEndpoint, apiKey, modelParams } =
    await req.json();

  if (!agentCode || !name || !platform) {
    return NextResponse.json({ error: "请填写编号、名称和平台" }, { status: 400 });
  }

  const { data, error } = await db
    .from("agents")
    .insert({
      agent_code: agentCode.toUpperCase(),
      name,
      description: description ?? "",
      category_id: categoryId || null,
      platform,
      agent_type: agentType ?? "chat",
      external_url: externalUrl ?? "",
      api_endpoint: apiEndpoint ?? "",
      api_key_enc: apiKey ?? "",       // 生产环境建议加密存储
      model_params: modelParams ?? {},
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "智能体编号已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
