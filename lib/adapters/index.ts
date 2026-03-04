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
    case "zhipu":
      yield* zhipuStream(messages, config);
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
    try {
      const obj = JSON.parse(data);
      const isMessageDelta =
        event === "conversation.message.delta" ||
        obj.event === "conversation.message.delta";
      if (isMessageDelta) {
        // v3: content 直接在 obj，或嵌套在 obj.data
        return obj.content ?? obj.data?.content ?? null;
      }
    } catch {}
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

// ─── 智谱清言 (GLM) ──────────────────────────────────────────────────────────

async function* zhipuStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string> {
  const model = (config.modelParams["model"] as string) ?? "glm-4-flash";
  const body = {
    model,
    messages,
    stream: true,
    temperature: config.modelParams["temperature"] ?? 0.7,
    max_tokens: config.modelParams["max_tokens"] ?? 2000,
  };

  const res = await fetch(
    config.apiEndpoint || "https://open.bigmodel.cn/api/paas/v4/chat/completions",
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
    throw new Error(`Zhipu API error: ${res.status} ${await res.text()}`);
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
