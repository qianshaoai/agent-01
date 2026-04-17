import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.agentCode !== undefined) updates.agent_code = body.agentCode;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.platform !== undefined) updates.platform = body.platform;
  if (body.agentType !== undefined) updates.agent_type = body.agentType;
  if (body.externalUrl !== undefined) updates.external_url = body.externalUrl;
  if (body.apiEndpoint !== undefined) updates.api_endpoint = body.apiEndpoint;
  if (body.apiKey) updates.api_key_enc = encrypt(body.apiKey);
  if (body.modelParams !== undefined) updates.model_params = body.modelParams;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  // 多分类：全量替换 agent_categories 表中的关联
  if (body.categoryIds !== undefined || body.categoryId !== undefined) {
    const catIds: string[] = Array.isArray(body.categoryIds)
      ? body.categoryIds
      : body.categoryId
        ? [body.categoryId]
        : [];
    await db.from("agent_categories").delete().eq("agent_id", id);
    if (catIds.length > 0) {
      await db.from("agent_categories").insert(catIds.map((cid) => ({ agent_id: id, category_id: cid })));
    }
    // 兼容旧字段：把第一个分类作为主分类写到 agents.category_id
    updates.category_id = catIds[0] ?? null;
  }

  // 组织分配
  if (body.tenantCodes !== undefined) {
    await db.from("tenant_agents").delete().eq("agent_id", id);
    if (body.tenantCodes.length > 0) {
      await db.from("tenant_agents").insert(
        body.tenantCodes.map((code: string) => ({ tenant_code: code, agent_id: id }))
      );
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from("agents")
      .update(updates)
      .eq("id", id);
    if (error) {
      if (error.code === "23505") return apiError("该编号已被其他智能体使用，请换一个编号", "CONFLICT");
      return dbError(error);
    }
  }

  return NextResponse.json({ ok: true });
}
