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

/**
 * 删除智能体
 * 4.29up：被工作流步骤引用时硬阻止（409 + used_by 引用列表）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  if (!id) return apiError("id 必填", "VALIDATION_ERROR");

  // 1) 引用检查：聚合到工作流维度
  const { data: refs, error: refsErr } = await db
    .from("workflow_steps")
    .select("workflow_id, workflows(id, name)")
    .eq("agent_id", id);
  if (refsErr) return dbError(refsErr);

  if (refs && refs.length > 0) {
    type WfRow = { workflow_id: string; workflows: { id: string; name: string } | null };
    const map = new Map<string, { id: string; name: string; stepCount: number }>();
    for (const r of refs as unknown as WfRow[]) {
      const wf = r.workflows;
      if (!wf?.id) continue;
      const cur = map.get(wf.id) ?? { id: wf.id, name: wf.name, stepCount: 0 };
      cur.stepCount += 1;
      map.set(wf.id, cur);
    }
    const used_by = [...map.values()];
    if (used_by.length > 0) {
      // 现有 apiError 只收 (message, code) 2 参且 ErrorCode 不含 "AGENT_IN_USE"
      // 此处直接 NextResponse.json，避免改全局 apiError 类型签名
      return NextResponse.json(
        {
          error: `该智能体被 ${used_by.length} 个工作流引用，无法删除`,
          code: "AGENT_IN_USE",
          used_by,
        },
        { status: 409 }
      );
    }
  }

  // 2) 真删；用 .select("id") 区分"被删了 N 行" vs "记录不存在"
  const { data: deleted, error: delErr } = await db
    .from("agents")
    .delete()
    .eq("id", id)
    .select("id");
  if (delErr) return dbError(delErr);
  if (!deleted || deleted.length === 0) {
    return apiError("智能体不存在或已被删除", "NOT_FOUND");
  }

  return NextResponse.json({ ok: true });
}
