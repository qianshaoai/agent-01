import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-C · 把草稿发布到正式 agents 表
//
// 设计要点：
// 1. 重复发布同一草稿不会创建多个 agent（按 published_from_draft_id 唯一匹配，找到则 update，否则 insert）
// 2. **PR-D 启用边界约束**：发布出的 agent 默认 enabled=false。
//    PR-D（chat 链路兼容 provider）合入并回归通过后，再批量启用。
//    避免在 PR-D 之前用户已经能看到新 agent 但聊不通的体验断层。
// 3. system_prompt 既写到 builder_config 也写到 model_params（兼容旧 chat route 读取）
// 4. agent_code 生成：草稿首次发布 → AGT-BUILD-{draft.id前8位}；重复发布沿用旧 code

type DraftRow = {
  id: string;
  name: string;
  description: string;
  category_ids: string[];
  provider_id: string | null;
  agent_type: string;
  external_url: string;
  builder_config: Record<string, unknown>;
  model_params: Record<string, unknown>;
  visibility_config: Record<string, unknown>;
  status: string;
  published_agent_id: string | null;
  created_by: string | null;
};

type ProviderRow = {
  id: string;
  platform: string;
  api_endpoint: string;
  enabled: boolean;
  default_model: string;
  default_params: Record<string, unknown>;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权发布智能体草稿", "FORBIDDEN");
  }

  const { id } = await params;

  // 加载草稿
  const { data: draftRow, error: draftErr } = await db
    .from("agent_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (draftErr) {
    console.error("[draft publish load]", draftErr);
    return apiError("加载草稿失败", "INTERNAL_ERROR");
  }
  const draft = draftRow as DraftRow | null;
  if (!draft) return apiError("草稿不存在", "NOT_FOUND");

  // ── 校验 ──
  if (!draft.name?.trim()) return apiError("草稿名称不能为空", "VALIDATION_ERROR");

  if (draft.agent_type === "external") {
    if (!draft.external_url?.trim()) {
      return apiError("外链型智能体必须填写跳转 URL", "VALIDATION_ERROR");
    }
  } else {
    // chat 类型
    if (!draft.provider_id) {
      return apiError("对话型智能体必须选择模型供应商", "VALIDATION_ERROR");
    }
    const systemPrompt = typeof draft.builder_config?.system_prompt === "string"
      ? (draft.builder_config.system_prompt as string).trim()
      : "";
    if (systemPrompt.length < 10) {
      return apiError("建议系统提示词至少 10 个字符，请补充人设描述", "VALIDATION_ERROR");
    }
  }

  // ── 加载 provider（仅 chat 类型）──
  let provider: ProviderRow | null = null;
  if (draft.agent_type === "chat" && draft.provider_id) {
    const { data: pRow, error: pErr } = await db
      .from("model_providers")
      .select("id, platform, api_endpoint, enabled, default_model, default_params")
      .eq("id", draft.provider_id)
      .maybeSingle();
    if (pErr) {
      console.error("[draft publish load provider]", pErr);
      return apiError("加载模型供应商失败", "INTERNAL_ERROR");
    }
    provider = pRow as ProviderRow | null;
    if (!provider) return apiError("绑定的模型供应商已删除", "VALIDATION_ERROR");
    if (!provider.enabled) {
      return apiError("绑定的模型供应商已禁用，请先启用或更换", "VALIDATION_ERROR");
    }
  }

  // ── 找已存在的 agent（重发布场景）──
  let existingAgentId: string | null = draft.published_agent_id;
  if (!existingAgentId) {
    const { data: foundAgent } = await db
      .from("agents")
      .select("id")
      .eq("published_from_draft_id", draft.id)
      .maybeSingle();
    if (foundAgent) existingAgentId = (foundAgent as { id: string }).id;
  }

  // agent_code 生成
  const agentCode = existingAgentId
    ? null // upsert 时不动 agent_code
    : `AGT-BUILD-${draft.id.slice(0, 8).toUpperCase()}`;

  // 合并 model_params：provider.default_params + draft.model_params + system_prompt（兼容旧 route）
  const builderConfig = draft.builder_config ?? {};
  const systemPrompt = typeof builderConfig.system_prompt === "string"
    ? (builderConfig.system_prompt as string)
    : "";
  const mergedModelParams: Record<string, unknown> = {
    ...(provider?.default_params ?? {}),
    ...(draft.model_params ?? {}),
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
  };
  if (!mergedModelParams.model && provider?.default_model) {
    mergedModelParams.model = provider.default_model;
  }

  // ── upsert agents ──
  // 注：agents.enabled 强制 false（PR-D 启用边界约束）
  //     现有 enabled=true 的 agent 如果被这个 draft 重发布，会被改成 false，
  //     这是预期行为：draft 改完重发布意味着内容变化，需要回归后再启用
  const agentPayload: Record<string, unknown> = {
    name: draft.name.trim(),
    description: (draft.description ?? "").trim(),
    platform: provider?.platform ?? "openai",
    api_endpoint: provider?.api_endpoint ?? draft.external_url ?? "",
    api_key_enc: "", // 走 provider_id 取 key，agent 自己不存 key
    model_params: mergedModelParams,
    enabled: false, // PR-D 启用边界
    // PR-B 加的字段
    provider_id: draft.provider_id ?? null,
    builder_config: builderConfig,
    published_from_draft_id: draft.id,
    // category_id 单选（旧 schema）→ 取 category_ids[0]
    category_id: Array.isArray(draft.category_ids) && draft.category_ids[0]
      ? draft.category_ids[0]
      : null,
    // agent_type / external_url 列若 agents 表后续也加了字段就直接落，否则忽略
    agent_type: draft.agent_type,
    external_url: draft.external_url ?? "",
  };

  let agentId: string;

  if (existingAgentId) {
    // 重发布：UPDATE
    const { data: updated, error: upErr } = await db
      .from("agents")
      .update(agentPayload)
      .eq("id", existingAgentId)
      .select("id")
      .single();
    if (upErr) {
      console.error("[draft publish update agent]", upErr);
      return apiError("更新已发布智能体失败：" + upErr.message, "INTERNAL_ERROR");
    }
    agentId = (updated as { id: string }).id;
  } else {
    // 首发：INSERT
    const insertPayload = { ...agentPayload, agent_code: agentCode };
    const { data: inserted, error: insErr } = await db
      .from("agents")
      .insert(insertPayload)
      .select("id")
      .single();
    if (insErr) {
      console.error("[draft publish insert agent]", insErr);
      return apiError("创建智能体失败：" + insErr.message, "INTERNAL_ERROR");
    }
    agentId = (inserted as { id: string }).id;
  }

  // ── 更新 draft 状态 ──
  await db
    .from("agent_drafts")
    .update({
      status: "published",
      published_agent_id: agentId,
      updated_by: admin.adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // 审计
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: existingAgentId ? "update" : "create",
    resourceType: "agent",
    resourceId: agentId,
    resourceName: draft.name,
    detail: {
      published_from_draft_id: draft.id,
      republish: !!existingAgentId,
      provider_id: draft.provider_id,
      agent_type: draft.agent_type,
      enabled: false, // 提醒后续启用边界
    },
  });

  return NextResponse.json({
    agent_id: agentId,
    agent_code: agentCode,
    enabled: false,
    republish: !!existingAgentId,
    note: "已发布但默认 enabled=false。PR-D（chat 链路兼容 provider）完成并回归通过后再统一启用。",
  });
}
