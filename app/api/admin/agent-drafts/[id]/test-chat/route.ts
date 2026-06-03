import { apiError } from "@/lib/api-error";
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { streamChat, ChatMessage } from "@/lib/adapters";
import { writeAuditLog } from "@/lib/audit";
import { retrieveKbChunks } from "@/lib/kb/retrieve";
import { buildKbStrictAnswerPrompt, buildKbUnavailablePrompt } from "@/lib/kb/prompt";
import { isMetaOrChitchatMessage } from "@/lib/kb/intent";
import { canReadRow } from "@/lib/scoped-access";

// 5.14up PR-C · 草稿测试聊天（SSE 流式，不入 messages 表，不扣额度）
// 权限：super_admin + system_admin 可（system_admin 看不到 key 明文，调用通过后端代理）
//
// 5.30up · R1 §2 草稿链路 RBAC 收口（差异化口径）：
//   - provider canReadRow 失败 → 403（无 provider 无法对话，硬阻断）
//   - KB ids 中不可见的 → 静默从 kbIds 过滤（不阻断对话；与 publish 的硬阻断不同
//     因为测试聊天是 admin 试用、KB 不可见时降级为"无 KB 的对话"比直接拒绝体验好）

const FIRST_BYTE_TIMEOUT_MS = 30_000;

type DraftRow = {
  id: string;
  name: string;
  agent_type: string;
  provider_id: string | null;
  builder_config: Record<string, unknown>;
  model_params: Record<string, unknown>;
};

type ProviderRow = {
  id: string;
  platform: string;
  api_endpoint: string;
  api_key_enc: string;
  default_model: string;
  default_params: Record<string, unknown>;
  enabled: boolean;
  // 5.30up · 归属字段（canReadRow 判定用）
  tenant_code: string | null;
};

function maskError(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-+/=.]+/gi, "Bearer ***")
    .replace(/Authorization:\s*[^\s,]+/gi, "Authorization: ***")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9_\-+/=.]+/gi, "$1***")
    .slice(0, 500);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const message: string = String(body.message ?? "").trim();
  const history: ChatMessage[] = Array.isArray(body.history) ? body.history.slice(-6) : [];

  if (!message) return apiError("消息不能为空", "VALIDATION_ERROR");

  // 加载 draft + provider
  const { data: draftRow, error: draftErr } = await db
    .from("agent_drafts")
    .select("id, name, agent_type, provider_id, builder_config, model_params, created_by")
    .eq("id", id)
    .maybeSingle();
  if (draftErr) {
    console.error("[draft test-chat load draft]", draftErr);
    return apiError("加载草稿失败", "INTERNAL_ERROR");
  }
  const draft = draftRow as DraftRow | null;
  if (!draft) return apiError("草稿不存在", "NOT_FOUND");
  // 5.19up · org_admin 只能测试自己创建的草稿
  if (admin.role === "org_admin"
      && (draftRow as { created_by?: string }).created_by !== admin.adminId) {
    return apiError("无权测试该草稿", "FORBIDDEN");
  }
  if (draft.agent_type !== "chat") {
    return apiError("外链型智能体不支持测试聊天", "VALIDATION_ERROR");
  }
  if (!draft.provider_id) {
    return apiError("草稿尚未选择模型供应商，无法测试", "VALIDATION_ERROR");
  }

  const { data: providerRow, error: provErr } = await db
    .from("model_providers")
    .select("*")
    .eq("id", draft.provider_id)
    .maybeSingle();
  if (provErr) {
    console.error("[draft test-chat load provider]", provErr);
    return apiError("加载模型供应商失败", "INTERNAL_ERROR");
  }
  const provider = providerRow as ProviderRow | null;
  if (!provider) return apiError("绑定的模型供应商已删除", "VALIDATION_ERROR");
  // 5.30up · R1 §2 · provider 不可见 → 403 硬阻断（无 provider 无法对话）
  if (!canReadRow(admin, provider)) {
    return apiError("无权使用该模型供应商（请重新选择）", "FORBIDDEN");
  }
  if (!provider.enabled) return apiError("绑定的模型供应商已禁用", "VALIDATION_ERROR");
  if (!provider.api_key_enc) return apiError("绑定的模型供应商未配置 API Key", "VALIDATION_ERROR");

  let apiKey: string;
  try {
    apiKey = decrypt(provider.api_key_enc);
  } catch (e) {
    console.error("[draft test-chat decrypt]", e);
    return apiError("模型供应商 API Key 解密失败", "INTERNAL_ERROR");
  }
  if (!apiKey) return apiError("模型供应商 API Key 为空", "INTERNAL_ERROR");

  // 合并参数：provider 默认 < draft 自定义 < 必要覆盖
  const builderConfig = draft.builder_config ?? {};
  const systemPrompt = typeof builderConfig.system_prompt === "string"
    ? builderConfig.system_prompt.trim()
    : "";

  const mergedParams: Record<string, unknown> = {
    ...(provider.default_params ?? {}),
    ...(draft.model_params ?? {}),
  };
  if (!mergedParams.model && provider.default_model) {
    mergedParams.model = provider.default_model;
  }

  // ── 5.19up 知识库B · 草稿测试聊天接知识库检索（与正式 chat 同口径） ──
  // 草稿没有正式的 agent_knowledge_bases，按 builder_config.knowledge_base_ids 取意图；
  // disabled / 已删 KB 由 v39 RPC 服务端兜底过滤（match_kb_chunks 已加 status='active'）。
  // 仅 openai / 智谱平台走检索；其他平台不接（约束 §7.1）；检索失败降级、不阻断测试。
  // 5.19up 三轮收口 · 硬规则 + 资料从 system 改为 inline 拼到 user 消息开头（与 chat 一致），
  //   弱模型对紧贴问题的指令遵守率更高。
  // 5.21up Fix · 闲聊型短消息（"你好" / "在吗" / 短追问）跳过 KB 检索 + 注入，与 chat 同
  //   口径；test-chat 无工作流，仅 B2 闲聊豁免、不用 B3 wfCtx 豁免。
  let kbInjectText = "";
  const skipKbForThisTurn = isMetaOrChitchatMessage(message, history.length);
  // 5.30.1 · anthropic 加入 KB 检索白名单（与 chat route 同口径）
  if ((provider.platform === "openai" || provider.platform === "zhipu" || provider.platform === "anthropic") && !skipKbForThisTurn) {
    const draftKbField = (builderConfig as Record<string, unknown>).knowledge_base_ids;
    const rawKbIds = Array.isArray(draftKbField)
      ? [...new Set((draftKbField as unknown[]).filter((x): x is string => typeof x === "string" && !!x))]
      : [];
    // 5.30up · R1 §2 · KB ids 中不可见的静默过滤（不阻断对话）
    let kbIds: string[] = rawKbIds;
    if (rawKbIds.length > 0) {
      const { data: kbRows } = await db
        .from("knowledge_bases")
        .select("id, tenant_code")
        .in("id", rawKbIds);
      const rows = (kbRows ?? []) as { id: string; tenant_code: string | null }[];
      const visibleSet = new Set(rows.filter((r) => canReadRow(admin, r)).map((r) => r.id));
      kbIds = rawKbIds.filter((kid) => visibleSet.has(kid));
      if (kbIds.length < rawKbIds.length) {
        console.info(
          `[draft test-chat] KB 过滤：${rawKbIds.length} 个引用中 ${kbIds.length} 个可见，` +
          `${rawKbIds.length - kbIds.length} 个不可见已剥离（admin=${admin.adminId}, draft=${draft.id}）`,
        );
      }
    }
    if (kbIds.length > 0) {
      try {
        // 6.4up R1.2-1 · test-chat 走 retrieveKbChunks 薄壳：
        //   - 启用 1-C 历史拼接（传 history），享受降 threshold + 自然语言召回提升
        //   - 不接 DB 记忆池（kb_context_state）—— 草稿无正式 conversation_id，
        //     不能撞 FK；admin 验记忆累积请走「发布草稿 + 正式 chat」路径
        const chunks = await retrieveKbChunks(kbIds, message, history);
        kbInjectText = buildKbStrictAnswerPrompt(chunks);
      } catch (e) {
        console.warn(
          `[draft test-chat] 知识库检索失败，降级为无知识库测试 draft=${draft.id}:`,
          e instanceof Error ? e.message : e,
        );
        kbInjectText = buildKbUnavailablePrompt();
      }
    }
  }

  const messages: ChatMessage[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...history,
    // 5.19up 三轮收口 · KB inline 拼到 user 消息前缀（详见 chat/route.ts 同位置注释）
    { role: "user" as const, content: kbInjectText + message },
  ];

  const startTime = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let firstByteAt: number | null = null;
      let firstByteTimer: ReturnType<typeof setTimeout> | null = null;
      let aborted = false;

      // 首字节 30s 超时（拉不到第一个 chunk 即报错）
      firstByteTimer = setTimeout(() => {
        if (!firstByteAt && !aborted) {
          aborted = true;
          const errMsg = `测试超时：${FIRST_BYTE_TIMEOUT_MS / 1000} 秒内未拉到首字节`;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
            controller.close();
          } catch {}
        }
      }, FIRST_BYTE_TIMEOUT_MS);

      try {
        const gen = streamChat(messages, {
          platform: provider.platform,
          apiEndpoint: provider.api_endpoint,
          apiKey,
          modelParams: mergedParams,
          agentCode: draft.id,
        });

        for await (const chunk of gen) {
          if (aborted) break;
          if (!firstByteAt) {
            firstByteAt = Date.now();
            if (firstByteTimer) clearTimeout(firstByteTimer);
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        if (!aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, latency_ms: Date.now() - startTime, first_byte_ms: firstByteAt ? firstByteAt - startTime : null })}\n\n`));
        }
      } catch (err) {
        const errMsg = maskError(err instanceof Error ? err.message : String(err));
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
        } catch {}
      } finally {
        if (firstByteTimer) clearTimeout(firstByteTimer);
        try { controller.close(); } catch {}

        // 写审计（不入 messages 表）—— 在流结束后异步写，不阻塞响应
        writeAuditLog({
          adminId: admin.adminId,
          adminUsername: admin.username,
          adminRole: admin.role,
          adminTenantCode: admin.tenantCode ?? null,
          action: "test",
          resourceType: "agent_draft",
          resourceId: draft.id,
          resourceName: draft.name,
          detail: {
            provider_id: draft.provider_id,
            platform: provider.platform,
            model: mergedParams.model,
            user_message_chars: message.length,
            first_byte_ms: firstByteAt ? firstByteAt - startTime : null,
            total_ms: Date.now() - startTime,
            aborted,
          },
        }).catch((e) => console.error("[draft test-chat audit]", e));
      }
    },
    cancel() {
      // 前端 abort 时清理（无需特殊操作，generator 会被 GC）
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
