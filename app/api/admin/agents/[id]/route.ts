import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.categoryId !== undefined) updates.category_id = body.categoryId || null;
  if (body.platform !== undefined) updates.platform = body.platform;
  if (body.agentType !== undefined) updates.agent_type = body.agentType;
  if (body.externalUrl !== undefined) updates.external_url = body.externalUrl;
  if (body.apiEndpoint !== undefined) updates.api_endpoint = body.apiEndpoint;
  if (body.apiKey) updates.api_key_enc = body.apiKey;
  if (body.modelParams !== undefined) updates.model_params = body.modelParams;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  // 企业分配
  if (body.tenantCodes !== undefined) {
    // 先删除旧分配
    await db.from("tenant_agents").delete().eq("agent_id", id);
    // 插入新分配
    if (body.tenantCodes.length > 0) {
      await db.from("tenant_agents").insert(
        body.tenantCodes.map((code: string) => ({ tenant_code: code, agent_id: id }))
      );
    }
  }

  const { data, error } = await db
    .from("agents")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
