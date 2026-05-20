import { apiError } from "@/lib/api-error";
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { streamChat, ChatMessage } from "@/lib/adapters";
import { writeAuditLog } from "@/lib/audit";
import { retrieveKbChunks } from "@/lib/kb/retrieve";

// 5.14up PR-C · 草稿测试聊天（SSE 流式，不入 messages 表，不扣额度）
// 权限：super_admin + system_admin 可（system_admin 看不到 key 明文，调用通过后端代理）

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
  let kbInjectText = "";
  if (provider.platform === "openai" || provider.platform === "zhipu") {
    const draftKbField = (builderConfig as Record<string, unknown>).knowledge_base_ids;
    const kbIds = Array.isArray(draftKbField)
      ? [...new Set((draftKbField as unknown[]).filter((x): x is string => typeof x === "string" && !!x))]
      : [];
    if (kbIds.length > 0) {
      try {
        const chunks = await retrieveKbChunks(kbIds, message);
        if (chunks.length > 0) {
          const refBlock = chunks.map((c, i) => `【资料 ${i + 1}】\n${c.content}`).join("\n\n");
          kbInjectText =
              "【知识库权威性 · 硬性规则，不可违反】\n" +
              "你正在使用一个内部知识库。下方「资料」就是事实，对资料覆盖的内容拥有最高权威。\n\n" +
              "规则（无条件适用，违反任何一条即错误回答）：\n" +
              "① 回答必须严格以「资料」为准，所有事实判断都以资料为最高依据。\n" +
              "② 即使资料与你的训练常识 / 世界知识 / 普遍认知严重冲突，**仍然以资料为准**。\n" +
              "   严禁出现以下任何形式的反驳/纠正/质疑：\n" +
              "   - 「实际上 / 事实上 / 通常来说 / 严格来说 / 准确地说 …」\n" +
              "   - 「这可能是误解 / 误传 / 错误信息 / 不准确」\n" +
              "   - 「正确的应该是 / 正确版本是 / 我建议参考 …」\n" +
              "   - 「资料里说 X，但实际是 Y」「资料提到 X，然而 …」\n" +
              "   - 任何「修正」「补充更准确信息」「提供正确版本」的句式\n" +
              "③ 资料未涵盖的问题 → 答完后另起一段，单独标注「以下来自常识，非知识库：」再说常识。\n" +
              "④ 用户的问题即便与资料字面矛盾，仍按资料回答；不要解释「资料为什么不对」。\n\n" +
              "—— 资料 ——\n" +
              refBlock +
              "\n\n—— 以下是本轮用户问题（请按上述硬规则作答）——\n";
        }
      } catch (e) {
        console.warn(
          `[draft test-chat] 知识库检索失败，降级为无知识库测试 draft=${draft.id}:`,
          e instanceof Error ? e.message : e,
        );
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
