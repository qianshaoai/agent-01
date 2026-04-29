// 4.28up 体验版模块 · 智能体配置
//
// 设计原则：
//   - 配置在源码，敏感值（botId / apiToken）走环境变量
//   - 启动时（模块加载时）打印 warn 列出缺配置的 agent
//   - getTrialAgent: 仅返回已配置的 agent（脱敏列表 + 正常 chat 用）
//   - getTrialAgentRaw: 返回 RAW，供 chat 接口区分 "id 不存在 → 404" vs "id 存在但缺 env → 500"

export type TrialAgent = {
  id: string;
  platform: "coze" | "dify" | "yuanqi" | "qingyan" | "openai";
  name: string;
  description: string;
  avatar: string;
  category: string;        // 用于左侧筛选栏分组
  apiEndpoint: string;
  botId: string;
  apiToken: string;
  /**
   * 4.30up：平台能力声明
   * - nativeDocuments: true  → 平台能自己读 PDF/docx 等（如 Coze RAG），透传 file_id 即可
   * - nativeDocuments: false → 平台不读文档，由 portal 后端用 pdf-parse/mammoth 提取文本
   *                            塞进消息正文里发给 AI（Yuanqi / 大多数平台都这样）
   */
  capabilities: {
    nativeDocuments: boolean;
  };
};

const RAW_AGENTS: TrialAgent[] = [
  {
    id: "agent_001",
    platform: "coze",
    name: "测试对话智能体",
    description: "用于测试智能体问答能力",
    avatar: "",
    category: "对话",
    apiEndpoint: "https://api.coze.cn/v3/chat",
    botId: process.env.TRIAL_AGENT_001_BOT_ID ?? "",
    apiToken: process.env.TRIAL_AGENT_001_API_TOKEN ?? "",
    capabilities: { nativeDocuments: false }, // 实测 bot 不读 docx → 走 portal 文本提取
  },
  {
    id: "agent_002",
    platform: "coze",
    name: "前哨-知识库入库整理",
    description: "辅助梳理与整理知识库入库内容",
    avatar: "",
    category: "知识",
    apiEndpoint: "https://api.coze.cn/v3/chat",
    botId: process.env.TRIAL_AGENT_002_BOT_ID ?? "",
    apiToken: process.env.TRIAL_AGENT_002_API_TOKEN ?? "",
    capabilities: { nativeDocuments: false }, // 实测 bot 不读 docx → 走 portal 文本提取
  },
  {
    id: "agent_003",
    platform: "yuanqi",
    name: "测试对话智能体2",
    description: "用于测试元器（腾讯）智能体问答能力",
    avatar: "",
    category: "对话",
    apiEndpoint: "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions",
    botId: process.env.TRIAL_AGENT_003_ASSISTANT_ID ?? "",
    apiToken: process.env.TRIAL_AGENT_003_API_KEY ?? "",
    capabilities: { nativeDocuments: false }, // 元器 OpenAPI 读不了文档，portal 预提取
  },
];

export const trialAgents: TrialAgent[] = RAW_AGENTS.filter((a) => {
  const ok = Boolean(a.botId && a.apiToken);
  if (!ok) {
    console.warn(`[trial-agents] disabled "${a.id}" — missing botId or apiToken in env`);
  }
  return ok;
});

export function getTrialAgentRaw(id: string): TrialAgent | null {
  return RAW_AGENTS.find((a) => a.id === id) ?? null;
}

export function getTrialAgent(id: string): TrialAgent | null {
  return trialAgents.find((a) => a.id === id) ?? null;
}
