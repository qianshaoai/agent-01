import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-C · 把草稿发布到正式 agents 表
//
// 设计要点：
// 1. 重复发布同一草稿不会创建多个 agent（按 published_from_draft_id 唯一匹配，找到则 update，否则 insert）
// 2. 5.16up · 发布即启用：PR-D 聊天链路兼容已上线，发布出的 agent 直接 enabled=true。
// 3. system_prompt 既写到 builder_config 也写到 model_params（兼容旧 chat route 读取）
// 4. agent_code 生成：草稿首次发布 → AGT-BUILD-{draft.id前8位}；重复发布沿用旧 code
// 5. 5.19up · 发布时把 visibility_config 翻译成 agent 的 resource_permissions（set_agent_permissions
//    RPC 原子全量替换）；scope 校验在任何 DB 写入之前；权限写入失败即发布失败、不标 draft published

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
  // 5.19up · org_admin 可发布，但后端强制最大可见范围为本组织（见下方可见范围校验）

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
  // 5.19up · org_admin 只能发布自己创建的草稿
  if (admin.role === "org_admin" && draft.created_by !== admin.adminId) {
    return apiError("无权发布该草稿", "FORBIDDEN");
  }

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

  // ── 5.19up · 校验可见范围 visibility_config（放在任何 DB 写入之前）──
  const visCfg = (draft.visibility_config ?? {}) as { visible_to?: string; scope?: unknown };
  let visibleTo = typeof visCfg.visible_to === "string" ? visCfg.visible_to : "owner_only";
  // 旧草稿值 "custom" / 未知值 → 降级 "owner_only"（安全侧，不误开放）
  if (visibleTo !== "all" && visibleTo !== "org" && visibleTo !== "owner_only") {
    visibleTo = "owner_only";
  }
  const rawScope: string[] = Array.isArray(visCfg.scope)
    ? (visCfg.scope as unknown[]).filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];
  let orgScope: string[] = [];

  if (admin.role === "org_admin") {
    // org_admin：后端强制最大可见范围 = 本组织
    if (!admin.tenantCode) {
      return apiError("组织管理员未绑定组织，无法发布", "FORBIDDEN");
    }
    if (visibleTo === "all") {
      return apiError("组织管理员不能发布「全平台可见」", "FORBIDDEN");
    }
    if (visibleTo === "org") {
      const uniq = [...new Set(rawScope)];
      if (uniq.length === 0) {
        orgScope = [admin.tenantCode]; // 未传 scope → 兜底归一化为本组织
      } else if (uniq.length === 1 && uniq[0] === admin.tenantCode) {
        orgScope = [admin.tenantCode];
      } else {
        return apiError("组织管理员只能发布到本组织", "FORBIDDEN");
      }
    }
    // visibleTo === "owner_only" → orgScope 留空，不写权限行
  } else {
    // super_admin / system_admin
    if (visibleTo === "org") {
      orgScope = [...new Set(rawScope)];
      if (orgScope.length === 0) {
        return apiError("「指定组织可见」需至少选择一个组织", "VALIDATION_ERROR");
      }
      const { data: tenantRows, error: tErr } = await db
        .from("tenants").select("code").in("code", orgScope);
      if (tErr) {
        console.error("[draft publish validate scope]", tErr);
        return apiError("校验可见组织失败", "INTERNAL_ERROR");
      }
      const validCodes = new Set((tenantRows ?? []).map((t: { code: string }) => t.code));
      const invalid = orgScope.filter((c) => !validCodes.has(c));
      if (invalid.length > 0) {
        return apiError(`可见范围含无效组织码：${invalid.join("、")}`, "VALIDATION_ERROR");
      }
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
  // 5.16up · 发布即启用：PR-D 聊天链路兼容已上线，发布出的 agent 直接 enabled=true，
  //   重发布同理（内容已确认，直接对外）。
  const agentPayload: Record<string, unknown> = {
    name: draft.name.trim(),
    description: (draft.description ?? "").trim(),
    platform: provider?.platform ?? "openai",
    api_endpoint: provider?.api_endpoint ?? draft.external_url ?? "",
    api_key_enc: "", // 走 provider_id 取 key，agent 自己不存 key
    model_params: mergedModelParams,
    enabled: true, // 5.16up · 发布即启用
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

  // ── 5.19up · 按可见范围全量替换该 agent 的 resource_permissions（原子 RPC）──
  const perms: Array<{ scope_type: string; scope_id: string | null }> =
    visibleTo === "all"
      ? [{ scope_type: "all", scope_id: null }]
      : visibleTo === "org"
        ? orgScope.map((code) => ({ scope_type: "org", scope_id: code }))
        : []; // owner_only → 不写权限行
  const { error: permErr } = await db.rpc("set_agent_permissions", {
    p_agent_id: agentId,
    p_perms: perms,
  });
  if (permErr) {
    console.error("[draft publish set permissions]", permErr);
    // 权限替换失败 → 发布失败，且不把 draft 标 published（幂等，可重试）
    return apiError("发布权限设置失败，请重试：" + permErr.message, "INTERNAL_ERROR");
  }

  // ── 5.19up 知识库B · 按 builder_config.knowledge_base_ids 全量同步 agent_knowledge_bases ──
  // 与可见范围 / 工作流的「全量替换」同口径：先删该 agent 全部绑定行，再按当前勾选写入。
  // 脏 id（指向已删知识库）在写入前按 knowledge_bases 实际存在性过滤掉，避免 FK 违例。
  // 失败 → 发布失败、不标 draft published（与 set_agent_permissions 同口径，幂等可重试）；
  // 否则会出现「发布成功但知识库没绑」的假成功（小B 验收 finding 2 收口，A 表已就绪后由
  // 非致命改为硬失败）。
  if (Array.isArray((builderConfig as Record<string, unknown>).knowledge_base_ids)) {
    const kbIds = [
      ...new Set(
        ((builderConfig as Record<string, unknown>).knowledge_base_ids as unknown[])
          .filter((x): x is string => typeof x === "string" && x.trim() !== ""),
      ),
    ];
    const { error: delErr } = await db
      .from("agent_knowledge_bases")
      .delete()
      .eq("agent_id", agentId);
    if (delErr) {
      console.error("[draft publish sync agent_knowledge_bases delete]", delErr);
      return apiError("知识库绑定同步失败（清旧绑定），请重试：" + delErr.message, "INTERNAL_ERROR");
    }
    if (kbIds.length > 0) {
      const { data: existRows, error: exErr } = await db
        .from("knowledge_bases")
        .select("id")
        .in("id", kbIds);
      if (exErr) {
        console.error("[draft publish sync agent_knowledge_bases validate]", exErr);
        return apiError("知识库绑定同步失败（校验存在性），请重试：" + exErr.message, "INTERNAL_ERROR");
      }
      const validIds = new Set((existRows ?? []).map((r: { id: string }) => r.id));
      const rows = kbIds
        .filter((kid) => validIds.has(kid))
        .map((kid) => ({ agent_id: agentId, kb_id: kid }));
      if (rows.length > 0) {
        const { error: insErr } = await db.from("agent_knowledge_bases").insert(rows);
        if (insErr) {
          console.error("[draft publish sync agent_knowledge_bases insert]", insErr);
          return apiError("知识库绑定同步失败（写新绑定），请重试：" + insErr.message, "INTERNAL_ERROR");
        }
      }
    }
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
      enabled: true,
      visible_to: visibleTo,
    },
  });

  return NextResponse.json({
    agent_id: agentId,
    agent_code: agentCode,
    enabled: true,
    republish: !!existingAgentId,
  });
}
