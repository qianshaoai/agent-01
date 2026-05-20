import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.7up · org_admin 只读，禁止修改智能体（含禁用/启用）
  if (admin.role === "org_admin") {
    return apiError("无权修改智能体", "FORBIDDEN");
  }

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
  // 5.15up PR-4 收口 · 旧"手输 API Key"入口已废弃：PATCH 不再接受 apiKey 写入
  //   api_key_enc。智能体 API Key 统一在「API 管理」里维护，agent 侧只走 provider_id 引用。
  if (body.modelParams !== undefined) updates.model_params = body.modelParams;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  // 5.15up · 平台 / provider_id 一致性（PR-2 + 小B 评审 Medium）
  //   - 显式传 providerId：按**变更后**的平台校验 provider 的 category
  //   - 只改平台、没动 providerId：已绑 provider 若与新平台类型不符 → 自动解绑，
  //     避免 platform=openai 却绑着智能体类 provider 这种不一致状态
  let providerAutoUnbound = false;
  if (body.platform !== undefined || body.providerId !== undefined) {
    const { data: agentRow0 } = await db
      .from("agents").select("platform, provider_id").eq("id", id).maybeSingle();
    if (!agentRow0) return apiError("智能体不存在", "NOT_FOUND");
    // 变更后的有效平台（同一次 PATCH 改了 platform 就用新值）
    const effPlatform =
      typeof body.platform === "string" && body.platform ? body.platform : agentRow0.platform;
    const wantCategory =
      ["coze", "dify", "yuanqi", "qingyan"].includes(effPlatform) ? "agent" : "model";

    if (body.providerId !== undefined) {
      if (!body.providerId) {
        updates.provider_id = null;
      } else if (typeof body.providerId === "string") {
        const { data: prov, error: provErr } = await db
          .from("model_providers")
          .select("enabled, category")
          .eq("id", body.providerId)
          .maybeSingle();
        if (provErr) return dbError(provErr);
        if (!prov) return apiError("选择的命名 API 不存在", "VALIDATION_ERROR");
        if (!prov.enabled) {
          return apiError("选择的命名 API 已禁用，请先在 API 管理里启用", "VALIDATION_ERROR");
        }
        if (prov.category !== wantCategory) {
          return apiError(
            `该智能体应绑定${wantCategory === "agent" ? "智能体 API" : "大模型 API"}`,
            "VALIDATION_ERROR"
          );
        }
        updates.provider_id = body.providerId;
      } else {
        return apiError("providerId 格式错误", "VALIDATION_ERROR");
      }
    } else if (body.platform !== undefined && agentRow0.provider_id) {
      // 只改了平台、没动 provider：已绑 provider 与新平台类型不符则自动解绑
      const { data: boundProv } = await db
        .from("model_providers")
        .select("category")
        .eq("id", agentRow0.provider_id)
        .maybeSingle();
      if (!boundProv || boundProv.category !== wantCategory) {
        updates.provider_id = null;
        providerAutoUnbound = true;
      }
    }
  }

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
    const { data: agentRow } = await db.from("agents").select("name").eq("id", id).single();
    const { error } = await db
      .from("agents")
      .update(updates)
      .eq("id", id);
    if (error) {
      if (error.code === "23505") return apiError("该编号已被其他智能体使用，请换一个编号", "CONFLICT");
      return dbError(error);
    }
    const action = updates.enabled === true ? "enable" : updates.enabled === false ? "disable" : "update";
    await writeAuditLog({
      adminId: admin.adminId,
      adminUsername: admin.username,
      adminRole: admin.role ?? "super_admin",
      adminTenantCode: admin.tenantCode ?? null,
      action,
      resourceType: "agent",
      resourceId: id,
      resourceName: agentRow?.name,
    });
  }

  // providerUnbound：平台变更导致原 API 绑定类型不符被自动解绑，前端据此提示重新配置
  return NextResponse.json({ ok: true, providerUnbound: providerAutoUnbound });
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
  // 5.7up · org_admin 只读，禁止删除智能体
  if (admin.role === "org_admin") {
    return apiError("无权删除智能体", "FORBIDDEN");
  }

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

  // 5.11up · 删除前缓存 tenant 归属（agent 通过 tenant_agents 反查，删完就没了）
  const resourceTenantCode = await resolveResourceTenantCode("agent", id);

  // 2) 真删；用 .select("id, name") 区分"被删了 N 行" vs "记录不存在"
  const { data: deleted, error: delErr } = await db
    .from("agents")
    .delete()
    .eq("id", id)
    .select("id, name");
  if (delErr) return dbError(delErr);
  if (!deleted || deleted.length === 0) {
    return apiError("智能体不存在或已被删除", "NOT_FOUND");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role ?? "super_admin",
    adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode,
    action: "delete",
    resourceType: "agent",
    resourceId: id,
    resourceName: (deleted[0] as { name?: string }).name,
  });

  return NextResponse.json({ ok: true });
}
