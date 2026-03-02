// ─── Mock Data for Phase 2 UI Preview ───────────────────────────────────────

export const mockTenant = {
  code: "DEMO2024",
  name: "前哨科技示例企业",
  quota: 500,
  quotaUsed: 127,
  expiresAt: "2025-12-31",
};

export const mockUser = {
  phone: "138****8888",
  tenantCode: "DEMO2024",
  tenantName: "前哨科技示例企业",
  isPersonal: false,
  firstLogin: false,
};

export const mockCategories = [
  { id: "1", name: "全部", count: 8 },
  { id: "2", name: "文案写作", count: 3 },
  { id: "3", name: "数据分析", count: 2 },
  { id: "4", name: "客户服务", count: 2 },
  { id: "5", name: "知识问答", count: 1 },
];

export const mockAgents = [
  {
    id: "AGT-001",
    name: "营销文案助手",
    description: "专业营销文案生成，支持多种场景：产品介绍、活动推广、朋友圈文案等，一键生成高转化内容。",
    categoryId: "2",
    categoryName: "文案写作",
    platform: "coze",
    enabled: true,
  },
  {
    id: "AGT-002",
    name: "数据分析师",
    description: "上传 Excel/CSV 数据，智能分析趋势、生成图表说明、提供业务洞察建议。",
    categoryId: "3",
    categoryName: "数据分析",
    platform: "dify",
    enabled: true,
  },
  {
    id: "AGT-003",
    name: "客服话术优化",
    description: "输入客户问题与你的回复，AI 帮你优化措辞，使沟通更专业、更有温度。",
    categoryId: "4",
    categoryName: "客户服务",
    platform: "zhipu",
    enabled: true,
  },
  {
    id: "AGT-004",
    name: "合同审查助手",
    description: "上传合同文件，智能识别风险条款、遗漏内容，给出专业修改建议（不构成法律意见）。",
    categoryId: "2",
    categoryName: "文案写作",
    platform: "coze",
    enabled: true,
  },
  {
    id: "AGT-005",
    name: "销售报告生成",
    description: "根据你提供的数据和关键信息，自动生成专业销售报告，节省 80% 整理时间。",
    categoryId: "3",
    categoryName: "数据分析",
    platform: "dify",
    enabled: true,
  },
  {
    id: "AGT-006",
    name: "FAQ 知识库问答",
    description: "基于企业知识库，快速回答内部员工或客户的常见问题，减少重复解答负担。",
    categoryId: "5",
    categoryName: "知识问答",
    platform: "coze",
    enabled: true,
  },
  {
    id: "AGT-007",
    name: "会议纪要助手",
    description: "粘贴会议记录或上传音频文字稿，自动整理为结构化会议纪要，包含待办事项。",
    categoryId: "4",
    categoryName: "客户服务",
    platform: "zhipu",
    enabled: true,
  },
  {
    id: "AGT-008",
    name: "品牌故事创作",
    description: "输入品牌信息和核心价值观，生成打动人心的品牌故事，适用于官网、融资材料等场景。",
    categoryId: "2",
    categoryName: "文案写作",
    platform: "coze",
    enabled: true,
  },
];

export const mockConversations = [
  {
    id: "conv-001",
    agentId: "AGT-001",
    title: "双十一活动文案策划",
    updatedAt: "2024-11-20 14:30",
  },
  {
    id: "conv-002",
    agentId: "AGT-001",
    title: "新品上市推广文案",
    updatedAt: "2024-11-19 10:15",
  },
  {
    id: "conv-003",
    agentId: "AGT-001",
    title: "朋友圈裂变活动设计",
    updatedAt: "2024-11-18 16:45",
  },
];

export const mockMessages = [
  {
    id: "msg-001",
    role: "user" as const,
    content: "帮我写一个双十一活动的朋友圈文案，产品是护肤品，主打年轻女性，折扣力度是全场5折。",
    createdAt: "14:22",
  },
  {
    id: "msg-002",
    role: "assistant" as const,
    content: `好的！这里为你准备了3个风格的朋友圈文案，可以根据你的品牌调性选择或组合使用：

**【版本一：情感共鸣型】**
✨ 双十一，给你的皮肤放个假 ✨
忙了一整年，是时候好好宠爱自己了～
全场5折，囤货正当时！
护肤不是花钱，是对自己的一种投资 🌸
→ 点击链接，今晚零点开始

**【版本二：直击痛点型】**
⚠️ 姐妹们注意！
今年双十一最值得囤的护肤品清单来了
全场直接5折，不是买一送一那种套路折扣
是货真价实的半价！
库存有限，先到先得 👇

**【版本三：幽默轻松型】**
双十一购物车：空的
双十一后：直接变美 😂
[品牌名] 全场5折
你不来，你闺蜜会来的～

需要我调整任何细节吗？比如加上具体产品名称、活动时间或者其他要求？`,
    createdAt: "14:23",
  },
  {
    id: "msg-003",
    role: "user" as const,
    content: "版本一不错，但能再加一点紧迫感吗？",
    createdAt: "14:25",
  },
  {
    id: "msg-004",
    role: "assistant" as const,
    content: `当然！加入限时紧迫感后的版本一：

**【版本一·加强版】**
✨ 双十一，给你的皮肤放个假 ✨
忙了一整年，是时候好好宠爱自己了～

⏰ **今晚24:00截止！全场5折**
错过等一年！

护肤不是花钱，是对自己的一种投资 🌸
→ 库存只剩 **最后200件**，点击抢购 👇

小Tips：加上真实库存数字（哪怕估算）效果更好，会让犹豫的朋友立刻行动。要不要我再给你做一个倒计时版本？`,
    createdAt: "14:25",
  },
];

export const mockNotices = [
  {
    id: "1",
    type: "global" as const,
    content: "🎉 欢迎使用前哨科技 AI 智能体平台！如有使用问题请联系客服。",
    enabled: true,
  },
  {
    id: "2",
    type: "enterprise" as const,
    content: "📢 【企业专属】本月新增「合同审查助手」和「会议纪要助手」，欢迎体验！额度已充值至12月底。",
    enabled: true,
  },
];

// ─── Admin Mock Data ────────────────────────────────────────────────────────

export const mockTenants = [
  {
    id: "1",
    code: "DEMO2024",
    name: "前哨科技示例企业",
    quota: 500,
    quotaUsed: 127,
    expiresAt: "2025-12-31",
    enabled: true,
    agentCount: 6,
  },
  {
    id: "2",
    code: "ALPHATECH",
    name: "阿尔法科技有限公司",
    quota: 200,
    quotaUsed: 89,
    expiresAt: "2025-06-30",
    enabled: true,
    agentCount: 4,
  },
  {
    id: "3",
    code: "BETACORP",
    name: "贝塔企业管理咨询",
    quota: 100,
    quotaUsed: 100,
    expiresAt: "2025-03-31",
    enabled: false,
    agentCount: 3,
  },
  {
    id: "4",
    code: "GAMMASOFT",
    name: "伽玛软件科技",
    quota: 1000,
    quotaUsed: 234,
    expiresAt: "2026-03-31",
    enabled: true,
    agentCount: 8,
  },
];

export const mockLogs = [
  {
    id: "1",
    phone: "138****8888",
    tenantCode: "DEMO2024",
    agentId: "AGT-001",
    agentName: "营销文案助手",
    action: "chat",
    status: "success",
    duration: 2341,
    createdAt: "2024-11-20 14:23:45",
  },
  {
    id: "2",
    phone: "139****9999",
    tenantCode: "ALPHATECH",
    agentId: "AGT-002",
    agentName: "数据分析师",
    action: "chat",
    status: "success",
    duration: 5123,
    createdAt: "2024-11-20 14:18:22",
  },
  {
    id: "3",
    phone: "137****7777",
    tenantCode: "BETACORP",
    agentId: "AGT-003",
    agentName: "客服话术优化",
    action: "chat",
    status: "error",
    duration: 0,
    error: "配额已耗尽",
    createdAt: "2024-11-20 14:05:11",
  },
  {
    id: "4",
    phone: "136****6666",
    tenantCode: "GAMMASOFT",
    agentId: "AGT-001",
    agentName: "营销文案助手",
    action: "login",
    status: "success",
    duration: 145,
    createdAt: "2024-11-20 13:55:03",
  },
  {
    id: "5",
    phone: "138****8888",
    tenantCode: "DEMO2024",
    agentId: "AGT-004",
    agentName: "合同审查助手",
    action: "upload",
    status: "success",
    duration: 1823,
    createdAt: "2024-11-20 13:42:17",
  },
];

export const mockAnalytics = {
  totalCalls: 3842,
  totalTenants: 4,
  successRate: 97.2,
  topAgents: [
    { id: "AGT-001", name: "营销文案助手", calls: 1203 },
    { id: "AGT-002", name: "数据分析师", calls: 876 },
    { id: "AGT-003", name: "客服话术优化", calls: 654 },
    { id: "AGT-006", name: "FAQ 知识库问答", calls: 521 },
    { id: "AGT-004", name: "合同审查助手", calls: 388 },
  ],
  tenantUsage: [
    { code: "DEMO2024", name: "前哨科技示例企业", used: 127, quota: 500 },
    { code: "ALPHATECH", name: "阿尔法科技", used: 89, quota: 200 },
    { code: "GAMMASOFT", name: "伽玛软件科技", used: 234, quota: 1000 },
    { code: "BETACORP", name: "贝塔企业管理咨询", used: 100, quota: 100 },
  ],
};
