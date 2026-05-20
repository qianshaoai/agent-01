/**
 * 5.15up · 把常见英文 / 技术性 AI 调用错误翻译成员工能看懂的中文
 *
 * 用于：
 * - app/api/agents/[id]/chat/route.ts
 * - app/api/user-agents/[id]/chat/route.ts
 * - 草稿测试聊天 SSE 流的 catch 也可以用（如果需要）
 *
 * 原则：
 * - 不暴露内部技术细节（stack / decrypt 关键字 / Authorization 等）
 * - 给员工明确的下一步动作建议（重试 / 联系管理员 / 等等）
 * - 错误类型识别不出来时保留原文加上"请稍后重试"前缀作为兜底
 */
export function humanizeChatError(raw: string): string {
  const m = raw.toLowerCase();

  // 网络层
  if (
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("network socket disconnected")
  ) {
    return "网络连接异常，请稍后重试";
  }
  if (m.includes("etimedout") || m.includes("timeout") || m.includes("超时")) {
    return "请求超时，请稍后重试";
  }
  if (m.includes("enotfound") || m.includes("dns")) {
    return "无法连接到智能体服务地址，请联系管理员";
  }

  // 上游 API 错误
  const apiMatch = raw.match(/API error:?\s*(\d{3})/i);
  if (apiMatch) {
    const code = parseInt(apiMatch[1], 10);
    if (code === 401 || code === 403) return "智能体接入凭证已失效或被拒绝，请联系管理员";
    if (code === 404) return "智能体接口地址不存在，请联系管理员核对配置";
    if (code === 429) return "调用过于频繁，请稍后再试";
    if (code === 500 || code === 502) return "智能体上游服务暂时故障，请稍后重试";
    if (code === 503) return "智能体上游暂时不可用，请稍后重试";
    if (code === 504) return "智能体上游响应超时，请稍后重试";
    return `智能体返回异常（HTTP ${code}），请稍后重试`;
  }

  // 解密 / 密钥
  if (m.includes("decrypt failed") || m.includes("密钥")) {
    return "智能体密钥不可用，请联系管理员";
  }

  // 上游返回空
  if (m.includes("ai 返回空内容") || m.includes("空响应") || m.includes("empty")) {
    return "智能体返回了空回复，请换种方式提问或稍后重试";
  }

  // 兜底：如果是中文就原样返回，是英文就加前缀
  const looksChinese = /[一-龥]/.test(raw);
  if (looksChinese) return raw;
  return `调用失败，请稍后重试（${raw.slice(0, 80)}）`;
}
