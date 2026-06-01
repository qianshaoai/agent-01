/**
 * 统一 AI 平台适配器
 * 每个适配器接收消息列表和配置，返回 AsyncGenerator<string>（流式文本块）
 */

/** 指数退避重试（用于非流式请求，如认证） */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export type ChatAttachment = {
  kind: "image" | "file";
  /** 文件名（用于显示和 file 类型降级渲染）*/
  fileName?: string;
  /** Supabase Storage 公开 URL — 所有平台都能读取 */
  url?: string;
  /** Coze 私有 file_id — 仅在 Coze 平台 + 上传到 Coze 时填 */
  cozeFileId?: string;
  /** @deprecated 旧字段，保留向后兼容；优先用 cozeFileId */
  fileId?: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  /** 多模态附件（仅部分平台支持，目前 coze） */
  attachments?: ChatAttachment[];
};

/** 5.16up W1 · token 用量（OpenAI 返回的 usage） */
export type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type AdapterConfig = {
  platform: string;
  apiEndpoint: string;
  apiKey: string;
  modelParams: Record<string, unknown>;
  agentCode: string;
  /** 平台侧会话 ID（部分平台用于维护多轮上下文） */
  platformConvId?: string | null;
  /** 适配器回调：当获取到平台侧新会话 ID 时通知调用方保存 */
  onPlatformConvId?: (id: string) => void;
  /** 5.16up W1 · 适配器拿到 token usage 时回调（目前仅 openai 平台会触发） */
  onUsage?: (usage: TokenUsage) => void;
};

export async function* streamChat(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  switch (config.platform) {
    case "coze":
      yield* cozeStream(messages, config);
      break;
    case "dify":
      yield* difyStream(messages, config);
      break;
    case "yuanqi":
      yield* yuanqiStream(messages, config);
      break;
    case "qingyan":
      yield* qingyanStream(messages, config);
      break;
    case "anthropic":
      yield* anthropicStream(messages, config);
      break;
    default:
      yield* openaiCompatibleStream(messages, config);
  }
}

// ─── Coze (扣子) ─────────────────────────────────────────────────────────────

async function* cozeStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  // 仅当调用方明确想要持久化（提供了 platformConvId 或 onPlatformConvId 回调）时
  // 才让 Coze 持久化此次会话；否则保持原有"无状态单轮"行为。
  const wantsPersistence = Boolean(config.platformConvId) || Boolean(config.onPlatformConvId);

  const body = {
    bot_id: config.modelParams["bot_id"] ?? config.agentCode,
    user_id: "portal_user",
    stream: true,
    auto_save_history: wantsPersistence,
    additional_messages: messages.map((m) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      // 有附件时走 Coze 多模态格式（object_string）
      if (m.attachments && m.attachments.length > 0) {
        const parts: Array<Record<string, string>> = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        for (const a of m.attachments) {
          // 优先用 cozeFileId（Coze 原生），其次 legacy fileId，再次 file_url（仅 image）
          const fid = a.cozeFileId || a.fileId;
          if (fid) {
            parts.push({ type: a.kind, file_id: fid });
          } else if (a.kind === "image" && a.url) {
            // Coze 图片类型支持外部 URL
            parts.push({ type: "image", file_url: a.url });
          } else if (a.url && a.kind === "file") {
            // file 类型 Coze 不接受外部 URL，降级为文本提示
            parts.push({ type: "text", text: `\n[文件: ${a.fileName ?? "附件"}](${a.url})` });
          }
        }
        return {
          role,
          content: JSON.stringify(parts),
          content_type: "object_string",
        };
      }
      return { role, content: m.content, content_type: "text" };
    }),
  };

  // 用 URL 对象拼 conversation_id 查询参数；不破坏调用方传入的其他参数
  const baseUrl = config.apiEndpoint || "https://api.coze.cn/v3/chat";
  const url = new URL(baseUrl);
  if (config.platformConvId) {
    url.searchParams.set("conversation_id", config.platformConvId);
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Coze API error: ${res.status} ${await res.clone().text()}`);
  }

  // 用闭包变量去重：同一 conversation_id 多次出现时只回调一次
  let notifiedConvId: string | null = config.platformConvId ?? null;

  yield* parseSSEStream(res, (data, event) => {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data);
    } catch {
      return null;
    }
    const evtType = event || (obj.event as string);

    // 捕获 conversation_id：chat.created 事件的 data 里有 conversation_id 字段
    if (config.onPlatformConvId) {
      const cid =
        (obj.conversation_id as string | undefined) ??
        ((obj.data as { conversation_id?: string } | undefined)?.conversation_id);
      if (cid && cid !== notifiedConvId) {
        notifiedConvId = cid;
        try {
          config.onPlatformConvId(cid);
        } catch {
          // 回调里抛错不影响流式
        }
      }
    }

    if (evtType === "conversation.chat.failed") {
      const errMsg = (obj.last_error as { msg?: string } | undefined)?.msg ?? JSON.stringify(obj);
      throw new Error(`Coze 错误: ${errMsg}`);
    }
    if (evtType === "conversation.message.delta") {
      return (obj.content as string) ?? (obj.data as { content?: string } | undefined)?.content ?? null;
    }
    return null;
  });
}

// ─── Dify ────────────────────────────────────────────────────────────────────

async function* difyStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  // Dify: last user message + history as conversation_id approach
  const userMsg = [...messages].reverse().find((m) => m.role === "user");
  // Dify 历史会话功能预留（走 conversation_id，暂未传入 history）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const history = messages.slice(0, -1);

  const body = {
    inputs: {},
    query: userMsg?.content ?? "",
    response_mode: "streaming",
    user: "portal_user",
    conversation_id: "",
    files: [],
  };

  const res = await fetch(
    config.apiEndpoint || "https://api.dify.ai/v1/chat-messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    throw new Error(`Dify API error: ${res.status} ${await res.clone().text()}`);
  }

  yield* parseSSEStream(res, (data) => {
    try {
      const obj = JSON.parse(data);
      if (obj.event === "message" && obj.answer) return obj.answer;
      if (obj.answer) return obj.answer; // some Dify versions omit event field
    } catch {}
    return null;
  });
}

// ─── 腾讯元器 (Yuanqi) ───────────────────────────────────────────────────────

async function* yuanqiStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  const body = {
    assistant_id: config.modelParams["assistant_id"] ?? config.agentCode,
    user_id: "portal_user",
    stream: true,
    chat_type: "published",
    messages: messages.map((m) => {
      // 元器 multimodal content 数组：image 用 image_url；file 用 text 降级
      const parts: Array<Record<string, unknown>> = [];

      // 文件类附件先收集到 text 末尾追加；image 插入独立 part
      let textContent = m.content || "";
      if (m.attachments && m.attachments.length > 0) {
        const fileNotes: string[] = [];
        const imageAtts: ChatAttachment[] = [];
        for (const a of m.attachments) {
          if (a.kind === "image" && a.url) {
            imageAtts.push(a);
          } else if (a.url) {
            fileNotes.push(`[文件: ${a.fileName ?? "附件"}](${a.url})`);
          }
        }
        if (fileNotes.length > 0) {
          textContent = (textContent ? textContent + "\n\n" : "") + fileNotes.join("\n");
        }
        if (textContent) parts.push({ type: "text", text: textContent });
        for (const img of imageAtts) {
          // 元器走 OpenAI 兼容格式：type 必须是 "image_url"，不是 "image"
          parts.push({ type: "image_url", image_url: { url: img.url } });
        }
      } else {
        parts.push({ type: "text", text: textContent });
      }

      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content: parts,
      };
    }),
  };

  const res = await fetch(
    config.apiEndpoint ||
      "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Source": "openapi",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    throw new Error(`Yuanqi API error: ${res.status} ${await res.clone().text()}`);
  }

  yield* parseSSEStream(res, (data) => {
    if (data === "[DONE]") return null;
    try {
      const obj = JSON.parse(data);
      return obj.choices?.[0]?.delta?.content ?? null;
    } catch {}
    return null;
  });
}

// ─── OpenAI-compatible (fallback) ────────────────────────────────────────────


async function* openaiCompatibleStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  const model = (config.modelParams["model"] as string) ?? "gpt-4o-mini";
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: config.modelParams["temperature"] ?? 0.7,
    max_tokens: config.modelParams["max_tokens"] ?? 2000,
  };
  // 5.16up W1 · 只对明确的 openai 平台请求 token usage。
  // 默认分支还接着 zhipu 等 OpenAI 兼容平台，有些不认 stream_options 会直接 400，
  // 不能一刀切（小B finding 3）。
  if (config.platform === "openai") {
    body.stream_options = { include_usage: true };
  }

  // 5.15up · dev 期网络抖动重试（仅在 fetch throw 时重试 2 次，HTTP 错误不重试）
  // 跟 lib/db.ts 的 retryingFetch 同思路：fetch 已经 resolve 就不动 stream
  let res: Response;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (lastErr) throw lastErr;
  res = res!;

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${await res.clone().text()}`);
  }

  yield* parseSSEStream(res, (data) => {
    if (data === "[DONE]") return null;
    try {
      const obj = JSON.parse(data);
      // 5.16up W1 · stream_options 的末 chunk：choices 为空、带 usage
      if (obj.usage && config.onUsage) {
        config.onUsage({
          prompt_tokens: obj.usage.prompt_tokens ?? 0,
          completion_tokens: obj.usage.completion_tokens ?? 0,
          total_tokens: obj.usage.total_tokens ?? 0,
        });
      }
      return obj.choices?.[0]?.delta?.content ?? null;
    } catch {}
    return null;
  });
}

// ─── Anthropic Messages API (Claude) ────────────────────────────────────────
// 5.30.1 · 接入 Anthropic 原生 messages 协议（非 OpenAI 兼容）。
//
// 协议要点（R2 方案落地）：
//   - endpoint: POST {apiEndpoint}（admin 配 /v1/messages 结尾，官方或中转皆可）
//   - 必需 header: anthropic-version: 2023-06-01
//   - 认证：官方 endpoint 用 x-api-key；非官方（中转）用 Authorization: Bearer
//   - body: { model, messages: [无 system], max_tokens, stream:true, system?, temperature? }
//   - SSE 事件结构（与 OpenAI 完全不同）：
//       event: message_start  → 含 usage.input_tokens
//       event: content_block_delta + delta.type=text_delta → yield delta.text
//       event: message_delta  → 含 usage.output_tokens（可能多次，取最后一次）
//       event: message_stop   → 流结束
//       event: error          → 必须 throw 让上层落错误分支
//
// 不在本期范围：extended thinking / tool_use / 多模态 attachments / cache_control
// 多模态 attachments → 直接 throw（防 silent 上线后才暴露）
//
// 已知限制：第三方中转可能注入隐藏 system prompt（如 Kiro），本平台代码改不了；
//          admin 知情接受（preset hint 已显式提示）。

async function* anthropicStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  // 1. attachments 暂不支持 → throw（不 silent drop）
  if (messages.some((m) => m.attachments?.length)) {
    throw new Error("[anthropic] 多模态 attachments 暂不支持，请先移除或换 platform");
  }

  // 2. 抽 system prompt（chat route 已把 system_prompt 塞进 messages[0].role=system，
  //    Anthropic 用顶层 system 字段，不是 messages 里的 role=system）
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");
  const systemText = systemMessages.map((m) => m.content).join("\n\n");

  // 3. 构造 body
  //    - max_tokens 不 clamp（Sonnet/Haiku 64k、Opus 4.8 128k，由上游 enforce）
  //    - temperature 不默认塞（Opus 4.7/4.8 不支持非默认采样参数；admin 显式配置时透传）
  const model = (config.modelParams.model as string) ?? "claude-haiku-4-5-20251001";
  const body: Record<string, unknown> = {
    model,
    messages: otherMessages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: (config.modelParams.max_tokens as number) ?? 2000,
    stream: true,
    ...(systemText ? { system: systemText } : {}),
    ...(config.modelParams.temperature !== undefined
      ? { temperature: config.modelParams.temperature }
      : {}),
  };

  // 4. 认证 header：官方 endpoint 用 x-api-key，中转用 Authorization: Bearer
  //    精确按 hostname 判断，避免代理 URL / query/path / 相似域名误判。
  let isOfficial = false;
  try {
    isOfficial = new URL(config.apiEndpoint).hostname === "api.anthropic.com";
  } catch {}
  const authHeader: Record<string, string> = isOfficial
    ? { "x-api-key": config.apiKey }
    : { Authorization: `Bearer ${config.apiKey}` };

  // 5. POST + 智能 retry：4xx 非 429 立即 break（不浪费 token）；5xx/429/网络错误才重试
  let res: Response | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: {
          ...authHeader,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        res = r;
        break;
      }
      const errText = await r.clone().text();
      lastErr = new Error(`Anthropic API ${r.status}: ${errText.slice(0, 300)}`);
      // 4xx 非 429 → 立即 break 跳出循环（不重试）
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt < 2) {
      await new Promise((rr) => setTimeout(rr, 300 * (attempt + 1)));
    }
  }
  if (!res) throw lastErr ?? new Error("[anthropic] fetch failed");

  // 6. SSE 解析：input_tokens 在 message_start，output_tokens 在 message_delta（多次出现取最后）
  //    event: error 必须 throw 让 chat route 落错误分支
  //    try/finally 兜底：流中断 / 502 截断时仍调 onUsage 防 logs.prompt_tokens 永远 0
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    yield* parseSSEStream(res, (data, event) => {
      try {
        const obj = JSON.parse(data);
        if (event === "message_start") {
          inputTokens = obj.message?.usage?.input_tokens ?? 0;
          return null;
        }
        if (event === "content_block_delta" && obj.delta?.type === "text_delta") {
          return obj.delta.text ?? null;
        }
        if (event === "message_delta") {
          // message_delta 可能多次出现，output_tokens 是累计值 → 取最后一次
          outputTokens = obj.usage?.output_tokens ?? outputTokens;
          return null;
        }
        if (event === "error") {
          throw new Error(
            `Anthropic stream error: ${obj.error?.type ?? "unknown"} - ${obj.error?.message ?? ""}`,
          );
        }
      } catch (e) {
        // Anthropic stream error 必须冒泡；JSON parse 错误吃掉
        if (e instanceof Error && e.message.startsWith("Anthropic stream")) throw e;
      }
      return null;
    });
  } finally {
    if (config.onUsage && (inputTokens || outputTokens)) {
      config.onUsage({
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      });
    }
  }
}

// ─── 智谱清言智能体 (Qingyan) ─────────────────────────────────────────────────

// Token cache: cacheKey -> { token, expiresAt }
const qingyanTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getQingyanToken(apiKey: string, apiSecret: string, baseUrl: string): Promise<string> {
  const cacheKey = `${apiKey}:${apiSecret}`;
  const cached = qingyanTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const data = await withRetry(async () => {
    const res = await fetch(`${baseUrl}/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
    });
    if (!res.ok) throw new Error(`Qingyan auth error: ${res.status} ${await res.clone().text()}`);
    const d = await res.json();
    if (d.status !== 0) throw new Error(`Qingyan auth failed: ${d.message}`);
    return d;
  });

  const { access_token, expires_in } = data.result;
  // 清理过期条目，防止内存泄漏
  for (const [k, v] of qingyanTokenCache) {
    if (v.expiresAt <= Date.now()) qingyanTokenCache.delete(k);
  }
  qingyanTokenCache.set(cacheKey, { token: access_token, expiresAt: Date.now() + expires_in * 1000 });
  return access_token;
}

async function* qingyanStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  const apiSecret = config.modelParams["api_secret"] as string;
  if (!apiSecret) throw new Error("Qingyan adapter: api_secret is required in model_params");

  const assistantId = (config.modelParams["assistant_id"] as string) ?? config.agentCode;
  const baseUrl = config.apiEndpoint?.replace(/\/stream$/, "") ||
    "https://chatglm.cn/chatglm/assistant-api/v1";

  const token = await getQingyanToken(config.apiKey, apiSecret, baseUrl);

  // Qingyan uses a single prompt; pass only the last user message
  const prompt = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const res = await fetch(`${baseUrl}/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistant_id: assistantId,
      prompt,
      ...(config.platformConvId ? { conversation_id: config.platformConvId } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Qingyan API error: ${res.status} ${await res.clone().text()}`);

  // Qingyan SSE returns full accumulated text each event, so we track prev length
  let prevLength = 0;
  yield* parseSSEStream(res, (data) => {
    try {
      const obj = JSON.parse(data);
      // Capture platform conversation_id and notify caller
      if (obj.conversation_id && config.onPlatformConvId) {
        config.onPlatformConvId(obj.conversation_id);
      }
      const content = obj.message?.content;
      if (!content) return null;
      const parts: Array<{ type: string; text?: string }> = Array.isArray(content)
        ? content
        : [content];
      const fullText = parts
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text as string)
        .join("");
      if (!fullText) return null;
      const delta = fullText.slice(prevLength);
      prevLength = fullText.length;
      return delta || null;
    } catch {}
    return null;
  });
}

// ─── SSE parser utility ──────────────────────────────────────────────────────


async function* parseSSEStream(
  res: Response,
  extract: (data: string, event: string) => string | null
): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          const text = extract(data, currentEvent);
          if (text) yield text;
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.cancel();
  }
}
