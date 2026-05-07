/**
 * 5.7up · 阶段二：历史摘要降本
 *
 * 角色：用一个便宜的国内 LLM（默认 zhipu glm-4-flash）把"老对话"压成简短摘要，
 *      让主对话模型每次少烧 input token。
 *
 * 配置：通过环境变量配置（与 agent 自身 key 解耦，平台层独立配置）
 *   SUMMARIZER_ENDPOINT  必填，OpenAI 兼容协议的 chat/completions 地址
 *   SUMMARIZER_API_KEY   必填，调用该端点用的密钥
 *   SUMMARIZER_MODEL     选填，默认 "glm-4-flash"
 *
 * 失败行为：任何调用失败（网络 / 401 / 解析错）一律返回 prevSummary（原值）
 *           或 null，调用方应继续走正常流程，不要因摘要失败 break 用户聊天。
 */

const ENDPOINT = process.env.SUMMARIZER_ENDPOINT;
const API_KEY = process.env.SUMMARIZER_API_KEY;
const MODEL = process.env.SUMMARIZER_MODEL ?? "glm-4-flash";

const SYSTEM_PROMPT =
  "你是对话历史压缩助手。请将提供的多轮对话提炼成简洁的'事实清单'：保留关键的人名 / 地名 / 时间 / 数字 / 决定 / 用户偏好 / 未解决问题；删除寒暄、重复确认、模型客套话。" +
  "如果输入里已经有'已有摘要'，请把'新增对话'里的新事实合并进去（不要丢已有摘要里的内容）。" +
  "只输出摘要正文（用编号或短句皆可），不要前言、不要 'Sure, here is...' 之类。控制在 500 字以内。";

export type SummarizableMsg = { role: string; content: string };

export function isSummarizerConfigured(): boolean {
  return !!(ENDPOINT && API_KEY);
}

/** 把 SummarizableMsg[] 拼成"用户: ... / 助手: ..." 形式的纯文本 */
function formatMessages(msgs: SummarizableMsg[]): string {
  return msgs
    .map((m) => {
      const speaker =
        m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "系统";
      return `${speaker}：${m.content}`;
    })
    .join("\n");
}

/**
 * 增量更新摘要。
 * @param prevSummary 上一次的摘要文本（首次为 null）
 * @param newOlderMessages 这次新冒出来的"老消息"（不应包含滑动窗口内的最近消息）
 * @returns 更新后的完整摘要文本；失败时返回 prevSummary 不破坏既有数据
 */
export async function summarizeOlderHistory(
  prevSummary: string | null,
  newOlderMessages: SummarizableMsg[]
): Promise<string | null> {
  if (!isSummarizerConfigured()) {
    return prevSummary;
  }
  if (!newOlderMessages || newOlderMessages.length === 0) {
    return prevSummary;
  }

  const userPrompt = prevSummary
    ? `已有摘要：\n${prevSummary}\n\n新增对话：\n${formatMessages(newOlderMessages)}\n\n请合并输出更新后的摘要：`
    : `请将以下对话压缩为事实清单：\n\n${formatMessages(newOlderMessages)}\n\n摘要：`;

  try {
    const res = await fetch(ENDPOINT!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      console.warn(
        "[summarizer] HTTP",
        res.status,
        await res.clone().text().catch(() => "")
      );
      return prevSummary;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      console.warn("[summarizer] empty content in response");
      return prevSummary;
    }
    return content.trim();
  } catch (err) {
    console.warn("[summarizer] error", err);
    return prevSummary;
  }
}
