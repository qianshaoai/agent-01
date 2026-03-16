/**
 * 统一 AI 平台适配器
 * 每个适配器接收消息列表和配置，返回 AsyncGenerator<string>（流式文本块）
 */

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
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
    default:
      yield* openaiCompatibleStream(messages, config);
  }
}

// ─── Coze (扣子) ─────────────────────────────────────────────────────────────

async function* cozeStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  const body = {
    bot_id: config.modelParams["bot_id"] ?? config.agentCode,
    user_id: "portal_user",
    stream: true,
    auto_save_history: false,
    additional_messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
      content_type: "text",
    })),
  };

  const res = await fetch(config.apiEndpoint || "https://api.coze.cn/v3/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Coze API error: ${res.status} ${await res.text()}`);
  }

  yield* parseSSEStream(res, (data, event) => {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data);
    } catch {
      return null;
    }
    const evtType = event || (obj.event as string);
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
    throw new Error(`Dify API error: ${res.status} ${await res.text()}`);
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
    messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ type: "text", text: m.content }],
    })),
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
    throw new Error(`Yuanqi API error: ${res.status} ${await res.text()}`);
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
  const body = {
    model,
    messages,
    stream: true,
    temperature: config.modelParams["temperature"] ?? 0.7,
    max_tokens: config.modelParams["max_tokens"] ?? 2000,
  };

  const res = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${await res.text()}`);
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

// ─── 智谱清言智能体 (Qingyan) ─────────────────────────────────────────────────

// Token cache: cacheKey -> { token, expiresAt }
const qingyanTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getQingyanToken(apiKey: string, apiSecret: string, baseUrl: string): Promise<string> {
  const cacheKey = `${apiKey}:${apiSecret}`;
  const cached = qingyanTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${baseUrl}/get_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
  });
  if (!res.ok) throw new Error(`Qingyan auth error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.status !== 0) throw new Error(`Qingyan auth failed: ${data.message}`);

  const { access_token, expires_in } = data.result;
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

  if (!res.ok) throw new Error(`Qingyan API error: ${res.status} ${await res.text()}`);

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
}
