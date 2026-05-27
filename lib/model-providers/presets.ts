// 5.27up · 大模型 / Embedding / 智能体 API 厂商预设目录
//
// 设计：
//   一个 ProviderPreset = (label 给人看) + (platform 给 adapter 用) + (endpoint / default_model
//   自动填入表单)。绝大多数 LLM 厂商都提供 OpenAI 兼容协议，统一走 platform="openai"
//   即可走 lib/adapters/index.ts 的 openaiCompatibleStream（无需写新 adapter）。
//   只有协议不通用的厂商才单独占 platform 值（zhipu / coze / dify / yuanqi / qingyan）。
//
// 加新厂商：
//   ① 在下面 LLM_PRESETS / EMBEDDING_PRESETS / AGENT_PRESETS 里加一项
//   ② 选 platform：OpenAI 兼容协议 → "openai"；GLM 系列 → "zhipu"；
//      其它专有协议 → 需在 lib/adapters/index.ts 加分支再选对应 platform 值
//   ③ 完成。后台 API 管理「新增 API」下拉里会立刻出现这个厂商，admin 选中即可
//      自动填 endpoint / 默认模型 / 默认参数，只需要补 name + provider_code + api_key。
//
// token usage 跟踪（5.16up W1/W2 加权扣额度依赖）：
//   只有 platform="openai" 分支会在 stream 请求里加 stream_options.include_usage（adapter:327）。
//   智谱平台明确不支持 stream_options，故走 zhipu 分支。
//   其它新增的 OpenAI 兼容厂商默认按 openai 走（绝大多数都支持 stream_options.include_usage）；
//   个别老接口若 400，到时退回自定义 endpoint + 关闭加权配额即可。

export type PresetCategory = "model" | "agent" | "embedding";

export type ProviderPreset = {
  /** 预设唯一编号（kebab-case，仅前端用，不入库）*/
  code: string;
  /** 下拉显示文案 */
  label: string;
  /** 对应 lib/adapters/index.ts 分发的 platform 值（入 model_providers.platform）*/
  platform: "openai" | "zhipu" | "coze" | "dify" | "yuanqi" | "qingyan";
  category: PresetCategory;
  /** 默认 api_endpoint（admin 可在表单里改）*/
  endpoint: string;
  /** 默认模型 / 接入点 ID */
  defaultModel: string;
  /** 默认参数（JSON）；不填走 {} */
  defaultParams?: Record<string, unknown>;
  /** 该厂商的小提示：去哪开账号 / 注意事项 */
  hint?: string;
  /**
   * 5.27up · 该厂商的推荐模型清单 —— 在智能体搭建器「模型名称」下拉里展示。
   * 仅当 category === "model" 时有意义。空数组 / undefined → 用户走「自定义模型名」手填。
   * 列出的是该厂商公开文档里的常用稳定型号，不写"旗舰/便宜"等主观标签（避免训练数据
   * 过期产生误导，参考 [[feedback-verify-external-urls]]）。
   */
  recommendedModels?: { value: string; label: string }[];
};

// ───────── 大模型 API · 仅保留 9 项常用国内 + OpenAI 基础 ──────────────────
// 用户决策：去掉长尾厂商（讯飞 / 阶跃 / Yi / 百川 / MiniMax / 商汤 /
// SiliconFlow / OpenRouter / Groq / Together），下拉太长反而难找。
// 后续如果真需要某家，再往下面加一项即可。
export const LLM_PRESETS: ProviderPreset[] = [
  {
    code: "openai-official",
    label: "OpenAI 官方（GPT-5.5 / GPT-5 / GPT-4o）",
    platform: "openai",
    category: "model",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.5",
    hint: "2026/04 GA 旗舰 gpt-5.5；需付费 OpenAI 账号；国内访问需经第三方中转 / VPN。",
    recommendedModels: [
      { value: "gpt-5.5",       label: "gpt-5.5（2026/04 最新主力）" },
      { value: "gpt-5.5-pro",   label: "gpt-5.5-pro（深度推理）" },
      { value: "gpt-5",         label: "gpt-5" },
      { value: "gpt-4o",        label: "gpt-4o" },
      { value: "gpt-4o-mini",   label: "gpt-4o-mini（便宜）" },
    ],
  },
  {
    code: "openai-compat-custom",
    label: "OpenAI 兼容（自定义 endpoint / 第三方中转 / 自部署）",
    platform: "openai",
    category: "model",
    endpoint: "",
    defaultModel: "",
    hint: "任意 OpenAI 兼容端点都用这个，手填 endpoint 和模型名。",
    // 自定义端点无法预知模型；走自定义模型名手填
    recommendedModels: [],
  },
  {
    code: "zhipu-glm",
    label: "智谱 GLM（glm-5 / glm-4.6 / glm-4-air）",
    platform: "zhipu",
    category: "model",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: "glm-5",
    hint: "智谱 BigModel；2026/02 起 glm-5 / glm-5.1 已上线（默认值用最新版）。⚠ 绑知识库智能体仍按 5.20up 验收锁定 glm-4-air 起步，glm-5 暂未端到端复测；具体 agent 在搭建器选择。",
    recommendedModels: [
      { value: "glm-5",       label: "glm-5（2026/02 最新主力）" },
      { value: "glm-5.1",     label: "glm-5.1" },
      { value: "glm-4.6",     label: "glm-4.6" },
      { value: "glm-4-air",   label: "glm-4-air（5.20up 知识库锁定）" },
      { value: "glm-4-plus",  label: "glm-4-plus" },
      { value: "glm-4-flash", label: "glm-4-flash（免费 · 不建议知识库）" },
    ],
  },
  {
    code: "qwen-dashscope",
    label: "通义千问 / DashScope（qwen3.7-max / qwen3.6-plus / qwen-plus）",
    platform: "openai",
    category: "model",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: "qwen3.6-plus",
    hint: "阿里云百炼，endpoint 路径含 compatible-mode 走 OpenAI 兼容协议。2026/04 GA qwen3.6-plus（百万 token 上下文），2026/05 旗舰 qwen3.7-max。",
    recommendedModels: [
      { value: "qwen3.7-max",  label: "qwen3.7-max（2026/05 旗舰）" },
      { value: "qwen3.6-plus", label: "qwen3.6-plus（2026/04 主力 · 1M 上下文）" },
      { value: "qwen3-max",    label: "qwen3-max" },
      { value: "qwen3-plus",   label: "qwen3-plus" },
      { value: "qwen-plus",    label: "qwen-plus（兼容）" },
      { value: "qwen-turbo",   label: "qwen-turbo（便宜）" },
      { value: "qwen-long",    label: "qwen-long（长文本）" },
    ],
  },
  {
    code: "doubao-ark",
    label: "字节豆包 / 火山方舟（doubao-pro / doubao-lite）",
    platform: "openai",
    category: "model",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    defaultModel: "",
    hint: "默认模型填火山方舟控制台「在线推理」给的接入点 ID（ep-xxx），不是模型名。",
    // 豆包用接入点 ID（ep-xxx）而非固定模型名，无法预填；admin 手填
    recommendedModels: [],
  },
  {
    code: "deepseek",
    label: "DeepSeek 深度求索（V4-Flash / V4-Pro）",
    platform: "openai",
    category: "model",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-v4-flash",
    hint: "platform.deepseek.com 注册，国内直连稳定，价格低。2026/04 GA V4（1M 上下文）。⚠ 旧别名 deepseek-chat / deepseek-reasoner 于 2026-07-24 弃用，新建一律用 v4-flash / v4-pro。",
    recommendedModels: [
      { value: "deepseek-v4-flash", label: "deepseek-v4-flash（2026/04 主力 · 便宜）" },
      { value: "deepseek-v4-pro",   label: "deepseek-v4-pro（强推理 / 代码 / Agent）" },
      { value: "deepseek-chat",     label: "deepseek-chat（旧别名 · 2026-07-24 弃用）" },
      { value: "deepseek-reasoner", label: "deepseek-reasoner（旧别名 · 2026-07-24 弃用）" },
    ],
  },
  {
    code: "moonshot",
    label: "月之暗面 Kimi / Moonshot（moonshot-v1-128k / K2 系列）",
    platform: "openai",
    category: "model",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: "moonshot-v1-128k",
    hint: "platform.moonshot.cn 注册，长文本场景常用。2026/04 GA Kimi K2.6 系列；platform.moonshot.cn 控制台「模型列表」确认实际 model ID 后手填覆盖（命名格式以官方为准）。",
    recommendedModels: [
      { value: "moonshot-v1-128k", label: "moonshot-v1-128k（默认 · 128K 上下文）" },
      { value: "moonshot-v1-32k",  label: "moonshot-v1-32k" },
      { value: "moonshot-v1-8k",   label: "moonshot-v1-8k（便宜）" },
    ],
  },
  {
    code: "ernie-qianfan",
    label: "百度文心 ERNIE / 千帆（ERNIE 5.0 / 4.5 Turbo / Speed-128K）",
    platform: "openai",
    category: "model",
    endpoint: "https://qianfan.baidubce.com/v2/chat/completions",
    defaultModel: "ernie-4.5-turbo-8k",
    hint: "千帆 V2 接口走 OpenAI 兼容；V1 不行，注意路径里的 /v2。2026/04 GA ERNIE 5.0（2.4T 参数）/ ERNIE 4.5 Turbo；千帆控制台「模型列表」确认实际 model ID 后手填覆盖。",
    recommendedModels: [
      { value: "ernie-4.5-turbo-8k", label: "ernie-4.5-turbo-8k（2026 主力）" },
      { value: "ernie-4.5-8k",       label: "ernie-4.5-8k" },
      { value: "ernie-speed-128k",   label: "ernie-speed-128k（兼容）" },
      { value: "ernie-4.0-8k",       label: "ernie-4.0-8k" },
      { value: "ernie-3.5-8k",       label: "ernie-3.5-8k（旧）" },
      { value: "ernie-lite-8k",      label: "ernie-lite-8k（便宜）" },
    ],
  },
  {
    code: "hunyuan",
    label: "腾讯混元 Hunyuan（hunyuan-turbos / TurboS / hunyuan-pro）",
    platform: "openai",
    category: "model",
    endpoint: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    defaultModel: "hunyuan-turbo",
    hint: "腾讯云开通混元服务即可使用。2026 主力 Hunyuan TurboS（快思考，2026/02 GA）；腾讯云控制台「混元大模型」确认实际 model ID 后手填覆盖。",
    recommendedModels: [
      { value: "hunyuan-turbos",   label: "hunyuan-turbos（2026 主力 · 快思考）" },
      { value: "hunyuan-turbo",    label: "hunyuan-turbo（默认）" },
      { value: "hunyuan-pro",      label: "hunyuan-pro" },
      { value: "hunyuan-standard", label: "hunyuan-standard" },
      { value: "hunyuan-lite",     label: "hunyuan-lite（便宜）" },
    ],
  },
];

// ───────── Embedding API ───────────────────────────────────────────────────
// 注意：当前 lib/kb/embed.ts 实现可能只接智谱 embedding-3；新增厂商前先确认 embed 实现
//      已支持，否则只是后台能配但实际不会被检索路径使用。
export const EMBEDDING_PRESETS: ProviderPreset[] = [
  {
    code: "zhipu-embedding-3",
    label: "智谱 Embedding（embedding-3，1024 维）",
    platform: "zhipu",
    category: "embedding",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/embeddings",
    defaultModel: "embedding-3",
    defaultParams: { dimensions: 1024 },
    hint: "embedding-3 默认 2048 维，用 dimensions 参数降到 1024 与 v37 表对齐。",
  },
  {
    code: "openai-embedding-3-small",
    label: "OpenAI Embedding（text-embedding-3-small / large）",
    platform: "openai",
    category: "embedding",
    endpoint: "https://api.openai.com/v1/embeddings",
    defaultModel: "text-embedding-3-small",
    defaultParams: { dimensions: 1024 },
    hint: "需 lib/kb/embed.ts 增加 openai 分支才会真生效；当前 KB 仅消费智谱。",
  },
  {
    code: "qwen-embedding",
    label: "通义千问 Embedding / DashScope（text-embedding-v3）",
    platform: "openai",
    category: "embedding",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
    defaultModel: "text-embedding-v3",
    defaultParams: { dimensions: 1024 },
    hint: "同上：需 embed 实现增加分支才会真生效。",
  },
  {
    code: "siliconflow-embedding",
    label: "SiliconFlow Embedding（BGE-M3 / BCE 等）",
    platform: "openai",
    category: "embedding",
    endpoint: "https://api.siliconflow.cn/v1/embeddings",
    defaultModel: "BAAI/bge-m3",
    hint: "国内便宜的 embedding；同上需 embed 实现支持。",
  },
];

// ───────── 智能体 API ───────────────────────────────────────────────────────
// 智能体平台 = 平台凭证 + bot_id（bot 在该平台侧配），不是 chat completion 协议。
// 必须有对应 adapter（lib/adapters/index.ts），新增需写代码，不只是加预设。
export const AGENT_PRESETS: ProviderPreset[] = [
  {
    code: "coze",
    label: "扣子 Coze（国内版）",
    platform: "coze",
    category: "agent",
    endpoint: "https://api.coze.cn/v3/chat",
    defaultModel: "",
    hint: "智能体 bot_id 在 coze.cn 平台侧配；这里只是平台凭证。",
  },
  {
    code: "dify",
    label: "Dify（自部署 / 云）",
    platform: "dify",
    category: "agent",
    endpoint: "",
    defaultModel: "",
    hint: "自部署 endpoint 形如 https://your-dify.com/v1/chat-messages。",
  },
  {
    code: "yuanqi",
    label: "腾讯元器",
    platform: "yuanqi",
    category: "agent",
    endpoint: "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions",
    defaultModel: "",
  },
  {
    code: "qingyan",
    label: "智谱清言",
    platform: "qingyan",
    category: "agent",
    endpoint: "",
    defaultModel: "",
  },
];

export const ALL_PRESETS: ProviderPreset[] = [
  ...LLM_PRESETS,
  ...EMBEDDING_PRESETS,
  ...AGENT_PRESETS,
];

export function getPresetsByCategory(category: PresetCategory): ProviderPreset[] {
  return ALL_PRESETS.filter((p) => p.category === category);
}

export function getPresetByCode(code: string): ProviderPreset | undefined {
  return ALL_PRESETS.find((p) => p.code === code);
}

/**
 * 反查已存数据对应的预设：先按 (platform + endpoint host) 精确匹配；
 * 同 host 多个预设（如同走 OpenAI 协议）按 endpoint 完整匹配；
 * 找不到时返回该 platform 下首个预设（一般是「OpenAI 兼容（自定义）」/「智谱 GLM」）。
 * 用于编辑现有 provider 时给「厂商预设」下拉填默认值。
 */
export function inferPresetFromExisting(
  platform: string,
  endpoint: string,
  category: PresetCategory,
): ProviderPreset {
  const pool = getPresetsByCategory(category);
  const norm = endpoint.trim().toLowerCase();
  if (norm) {
    const exact = pool.find((p) => p.endpoint.toLowerCase() === norm);
    if (exact) return exact;
    try {
      const host = new URL(endpoint).host.toLowerCase();
      const byHost = pool.find((p) => {
        if (!p.endpoint) return false;
        try { return new URL(p.endpoint).host.toLowerCase() === host; } catch { return false; }
      });
      if (byHost) return byHost;
    } catch { /* endpoint 非合法 URL，跳过 host 匹配 */ }
  }
  const byPlatform = pool.find((p) => p.platform === platform);
  if (byPlatform) return byPlatform;
  return pool[0]; // 兜底：该 category 第一项
}
