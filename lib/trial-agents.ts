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
