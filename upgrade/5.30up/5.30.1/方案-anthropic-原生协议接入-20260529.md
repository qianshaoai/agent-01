### 5.30.1 方案 · Anthropic 原生协议接入（Claude 系列模型）

日期：2026-05-29
作者：小A
状态：**R2 已按小B二审消歧，待实施**（未动代码 / DB / 配置）
版本：R2（2026-05-29 三改）
位置：`upgrade/5.30up/5.30.1/`（视为 5.30up RBAC 期间临时插队的小迭代）
依据：用户 2026-05-29 提出 ——

> 「我现在就要用这把 key，需要平台拥有调用 claude 系列模型的能力」

---

## 背景与触发

### 用户路径

用户搞到中转 key `https://claude.redcodeai.cn/v1/messages`，PowerShell 实测后发现：

- `GET /v1/models` → `{"data":[]}` 空（claude-code-hub 不暴露模型列表）
- `POST /v1/messages` + `Authorization: Bearer + anthropic-version: 2023-06-01` → ✓ 返回 Anthropic 标准响应：
  ```
  id          : msg_2c82e3a50f4641e9a2d278038dcb7c94
  type        : message
  model       : claude-haiku-4-5
  content     : [{type=text; text=Hey there. I'm Kiro...}]
  usage       : input_tokens=1; output_tokens=101; cache_creation_input_tokens=0; ...
  ```

### 协议判定

中转用 **Anthropic 原生 messages API**（路径 `/v1/messages`），不是 OpenAI chat completions。本平台 [`openaiCompatibleStream`](../../../lib/adapters/index.ts) 发 `/v1/chat/completions` 走不通——**路径 A（OpenAI 兼容直接配）已确认死路**。

需走**路径 B**：在 `lib/adapters/index.ts` 内联 Anthropic adapter（复用现有 `parseSSEStream`），并把 `anthropic` 加入 platform union。

### ⚠️ 已知不可改的限制 · Kiro 人格注入

PowerShell 实测响应内容：

> "Hey there. **I'm Kiro, an AI development environment**. I'm here to help you write code, debug issues, explore solutions..."

用户发 "你好"，正常 Claude 应该回中文问候。但**中转在请求转 Anthropic 前强制注入了一段把 Claude 包装成 "Kiro 开发助手" 的 system prompt**。

实际后果：

- admin 在搭建器写"你是李白，用古诗回答" → Claude 实际收到 **"你是 Kiro 开发助手" + "你是李白"** 双重人格 → 输出风格混乱
- 每次调用吃 hidden tokens（input_tokens 用户看到是 1，实际可能 600+ 被中转 swallow）
- 中转可随时改这段隐藏 prompt，本平台无感

**本方案不解决此问题** —— 用户拍板接受、先打通技术链路。**缓解措施**：在 API 管理页 anthropic platform 的 preset hint 文字里写明此风险，让 admin 知情。

### 与 5.30up 的关系

5.30up RBAC Phase Z 联合验收尚未跑。本期主要改 adapter / migration / preset / 路由白名单；R2 追加触达 agent-builder、chat route、draft test-chat 的小段逻辑（模型下拉与 KB gate），不改 5.30up ownership / 权限判定核心。

---

## 已验证事实（不再 explore）

### 1. Anthropic 当前模型与定价（WebSearch 2026-05 verify）

| 模型 | API ID | input / output (per MTok) |
|---|---|---|
| Haiku 4.5 | `claude-haiku-4-5-20251001` | $1 / $5 |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 |
| Opus 4.8 | `claude-opus-4-8` | $5 / $25 |

注：Anthropic 已于 **2026-05-28** 发布 Opus 4.8；本方案 R2 以 `claude-opus-4-8` 作为 Opus 推荐模型。

### 2. Anthropic Messages API 协议

- endpoint：`https://api.anthropic.com/v1/messages`
- 必需 header：`anthropic-version: 2023-06-01`、`Content-Type: application/json`；官方 API key 用 `x-api-key: <key>`，WIF/OAuth 短 token 才用 `Authorization: Bearer <token>`。本次中转实测接受 Bearer。
- body 字段差异（vs OpenAI）：
  - `system` 是顶层字段（**不是 messages 数组里的 role=system**）
  - `max_tokens` 必填
  - 不支持 `stream_options.include_usage`（usage 总是带）

### 3. Anthropic SSE 流式事件结构

```
event: message_start
data: {"type":"message_start","message":{...,"usage":{"input_tokens":10}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}

event: message_stop
data: {"type":"message_stop"}
```

关键点：
- 每条事件**有独立的 `event:` 行**（与 OpenAI 不同）
- `input_tokens` 在 `message_start`、`output_tokens` 在 `message_delta`（**分两次给**）
- `message_delta` 可能多次出现，output_tokens 是累计值，**取最后一次**
- 流式中途错误是 `event: error` + `data: {"type":"error","error":{...}}`

### 4. 本平台可复用的现有 utilities

| 工具 | 文件 | 作用 |
|---|---|---|
| `parseSSEStream(res, extract)` | [`lib/adapters/index.ts:469-500`](../../../lib/adapters/index.ts) | 复用，extract 回调签名 `(data: string, event: string) => string \| null` **已经支持 event 字段** |
| `TokenUsage` 类型 | [`lib/adapters/index.ts:43-48`](../../../lib/adapters/index.ts) | `{prompt_tokens, completion_tokens, total_tokens}`，anthropic adapter 内部做 `input_tokens → prompt_tokens` 映射 |
| `AdapterConfig` / `ChatMessage` 类型 | [`lib/adapters/index.ts:36-62`](../../../lib/adapters/index.ts) | adapter 签名复用 |
| `model_quota_weights` 表 + `increment_quota_used_weighted` RPC | [`supabase/migration_v25.sql:26-64`](../../../supabase/migration_v25.sql) | claude 模型种子加入即扣费链路打通 |
| chat route 已 unpack `system_prompt → messages[0].role=system` | [`app/api/agents/[id]/chat/route.ts:442-470`](../../../app/api/agents/[id]/chat/route.ts) | **anthropic adapter 反向抽出来塞 body.system** |

### 5. 现有 adapter SSE 解析模式（参考样板）

- **Coze** 容错模式：流中途 throw error 即中断
- **Dify / Yuanqi**：catch JSON 错误后 silent return null
- **openai 兼容**：末 chunk usage 字段 → 调 `config.onUsage`

anthropic adapter 选用 **Coze 模式（throw 中断）**，因 Anthropic `event: error` 必须 surface 让用户看到错误。

---

## 实施面（11 处改动 + 文档）

### Phase 0 · DB（必须先跑）

#### 新建 `supabase/migration_v44_anthropic_platform.sql`

```sql
-- 5.30.1 · 接入 Anthropic 原生协议 · 加 platform 'anthropic' + claude 系列权重种子
-- 来源：upgrade/5.30up/5.30.1/方案-anthropic-原生协议接入-20260529.md（R2 评审通过）
-- 改的表：model_providers.platform CHECK 约束扩 + model_quota_weights 种子加 3 条
-- 数据迁移：无（纯新增；现有行 platform 仍是 'openai'/'zhipu' 等不变）
--
-- 幂等：CHECK 约束 DROP + ADD；种子 ON CONFLICT DO NOTHING

ALTER TABLE model_providers DROP CONSTRAINT IF EXISTS model_providers_platform_check;
ALTER TABLE model_providers ADD CONSTRAINT model_providers_platform_check
  CHECK (platform IN ('openai','coze','dify','yuanqi','qingyan','zhipu','anthropic'));

INSERT INTO model_quota_weights (model_id, weight_per_call, enabled, note) VALUES
  ('claude-haiku-4-5-20251001',  3,  TRUE,  'Anthropic Haiku 4.5（轻量主力）'),
  ('claude-sonnet-4-6',          8,  TRUE,  'Anthropic Sonnet 4.6（平衡）'),
  ('claude-opus-4-8',            15, TRUE,  'Anthropic Opus 4.8（最强）')
ON CONFLICT (model_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```

#### 同步更新 `supabase/MIGRATIONS.md`

加 v44 索引条目：

| 文件 | 主要内容 | 跑过 |
|---|---|---|
| `migration_v44_anthropic_platform.sql` | **5.30.1 · Anthropic 接入**【🔑 接 claude 必跑】platform CHECK 扩 `'anthropic'` + `model_quota_weights` 种子加 haiku=3 / sonnet=8 / opus=15。⚠ 不跑此条 → 新建 anthropic provider 时被 CHECK 约束拒（platform 不允许）；用 claude 对话时 `model_quota_weights` 查不到走 weight=1 软放过（成本被低估） | ☐ |

#### 权重值依据（plan agent R0 challenge 后采纳）

| 模型 | 实际 output 价格倍数（基准 gpt-4o-mini=1） | 权重 | 理由 |
|---|---|---|---|
| Haiku 4.5 | 8.3x | **3** | "约 1/3 实际倍数 + 鼓励使用" 口径，对齐 5.7up 现有「gpt-4o=5（实际 16x）」折扣比 |
| Sonnet 4.6 | 25x | **8** | 略高于 gpt-4o weight=5，因 Sonnet 实际单价是 4o 的 1.5x |
| Opus 4.8 | 41x | **15** | 与 4.7 同价，对齐 o1-mini=15，admin 心智里「Opus ≈ o1-mini 档」|

### Phase 1 · adapter 主体

#### 改 `lib/adapters/index.ts`，内联新增 `anthropicStream`

不新建 `lib/adapters/anthropic.ts`。原因：`parseSSEStream` 当前是 `index.ts` 内部 helper，现有 adapter 也都内联在同文件；本期按最小改动复用现有结构。

签名：

```ts
async function* anthropicStream(
  messages: ChatMessage[],
  config: AdapterConfig
): AsyncGenerator<string>
```

#### 核心逻辑（R2 最终口径）

**1. attachments 直接报错**（不 silent drop，避免“图片没生效”上线后才暴露）：

```ts
if (messages.some(m => m.attachments?.length)) {
  throw new Error("[anthropic] 多模态 attachments 暂不支持，请先移除或换 platform");
}
```

**2. 抽 system prompt**（chat route 已塞进 messages[0].role=system，anthropic 反向抽）：

```ts
const systemMessages = messages.filter(m => m.role === "system");
const otherMessages  = messages.filter(m => m.role !== "system");
const systemText     = systemMessages.map(m => m.content).join("\n\n");
```

**3. 构造 body：max_tokens 不 clamp；temperature 不默认塞**：

```ts
const model = (config.modelParams.model as string) ?? "claude-haiku-4-5-20251001";
const body: Record<string, unknown> = {
  model,
  messages: otherMessages.map(m => ({ role: m.role, content: m.content })),
  max_tokens: (config.modelParams.max_tokens as number) ?? 2000,
  stream: true,
  ...(systemText ? { system: systemText } : {}),
  ...(config.modelParams.temperature !== undefined
    ? { temperature: config.modelParams.temperature } : {}),
};
```

说明：
- Anthropic 当前模型上限不是 8192（Sonnet / Haiku 64k，Opus 4.8 128k），本平台不硬截断，由上游 enforce。
- Opus 4.7/4.8 不支持非默认 `temperature/top_p/top_k`；adapter 不默认塞采样参数。若 admin 显式配置，错误明确冒泡。

**4. 认证 header：按 endpoint hostname 判断官方 / 中转**：

```ts
let isOfficial = false;
try {
  isOfficial = new URL(config.apiEndpoint).hostname === "api.anthropic.com";
} catch {}

const authHeaders: Record<string, string> = isOfficial
  ? { "x-api-key": config.apiKey }
  : { Authorization: `Bearer ${config.apiKey}` };
```

不用 `includes("api.anthropic.com")`，避免代理 URL 或 query/path 误判。官方 Anthropic API key 走 `x-api-key`；当前中转地址仍走 Bearer。

**5. POST + 智能 retry（4xx 非 429 不重试）**：

```ts
let res: Response | null = null;
let lastErr: Error | null = null;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const r = await fetch(config.apiEndpoint, {
      method: "POST",
      headers: {
        ...authHeaders,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (r.ok) { res = r; break; }
    lastErr = new Error(`Anthropic API ${r.status}: ${await r.clone().text()}`);
    if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
  } catch (e) {
    lastErr = e as Error;
  }
  if (attempt < 2) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
}
if (!res) throw lastErr ?? new Error("[anthropic] fetch failed");
```

**6. SSE 解析**（用 `parseSSEStream`，闭包累积 token + try/finally 兜底）：

```ts
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
        outputTokens = obj.usage?.output_tokens ?? outputTokens;
        return null;
      }
      if (event === "error") {
        throw new Error(`Anthropic stream error: ${obj.error?.type ?? "unknown"} - ${obj.error?.message ?? ""}`);
      }
    } catch (e) {
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
```

### Phase 2 · dispatch

#### 改 `lib/adapters/index.ts`

dispatch switch 加 case：

```ts
switch (config.platform) {
  case "coze":     yield* cozeStream(messages, config); break;
  case "dify":     yield* difyStream(messages, config); break;
  case "yuanqi":   yield* yuanqiStream(messages, config); break;
  case "qingyan":  yield* qingyanStream(messages, config); break;
  case "anthropic": yield* anthropicStream(messages, config); break;  // ✚ 5.30.1
  default:         yield* openaiCompatibleStream(messages, config);
}
```

### Phase 3 · 路由白名单

#### 改 `app/api/admin/model-providers/route.ts`

- `ALLOWED_PLATFORMS` 数组加 `'anthropic'`
- `CATEGORY_PLATFORMS.model` 数组加 `'anthropic'`（与 openai / zhipu 同列）

#### 改 `app/api/admin/model-providers/[id]/route.ts`

同上（PATCH 路径有自己的 ALLOWED_PLATFORMS / CATEGORY_PLATFORMS 副本）。

### Phase 4 · 测试探针

#### 改 `app/api/admin/model-providers/[id]/test/route.ts` — 0 代码改动

[`streamChat`](../../../lib/adapters/index.ts) 已抽象，dispatch 命中 `case "anthropic"` 自动走新 adapter。"连接成功" 四字检测通过 yield 出来的 text chunk 累积仍 work。

⚠️ **实施前需人工 verify**：Kiro 注入下让 Claude 回 "连接成功" 四字是否真能照做（中转给 Claude 的 system prompt 可能影响理解中文指令）。如失败 → 需放宽探针逻辑（如改为「流不为空 + 状态 200」即 ✓，不强制要求"连接成功"四字）。这是 R1 修订项备选。

### Phase 5 · 厂商预设

#### 改 `lib/model-providers/presets.ts`

**1. 扩 platform union 类型**：

```ts
type ProviderPreset = {
  // ...
  platform: "openai" | "zhipu" | "coze" | "dify" | "yuanqi" | "qingyan" | "anthropic";  // ✚
  // ...
}
```

**2. `LLM_PRESETS` 数组加一条 anthropic preset**：

```ts
{
  code: "anthropic-official",
  label: "Anthropic Claude（官方/中转）",
  platform: "anthropic",
  category: "model",
  endpoint: "",  // 决策点 2 · 留空强制 admin 主动填
  defaultModel: "claude-haiku-4-5-20251001",
  defaultParams: {},
  hint: "官方端点：https://api.anthropic.com/v1/messages；如使用第三方中转请填中转 URL。⚠️ 部分中转会注入隐藏 system prompt（如把 Claude 包装成其它助手），导致人设被污染、token 隐性消耗，请向中转方确认。",
  recommendedModels: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5（最快最省）" },
    { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6（平衡）" },
    { value: "claude-opus-4-8",           label: "Claude Opus 4.8（最强 · 2026-05-28）" },
  ],
}
```

⚠️ **model id 一致性约束**：preset.value 与 `model_quota_weights.model_id` 种子必须**完全一致**，否则 chat route 查 weight 查不到走 weight=1 软放过 → 成本被低估。

### Phase 6 · 前端与搭建器

#### 改 `app/admin/model-providers/page.tsx` — 可能 0 代码改动

5.27up 弹窗已从 `getPresetsByCategory("model")` 动态拉，新增 preset 自动出现。

**实施前需人工 verify**：选择 anthropic preset 后 endpoint 字段是否正常显示空（让 admin 填）+ hint 文案是否完整显示。

#### 改 `app/admin/agent-builder/[id]/page.tsx`

`platform === "anthropic"` 且 endpoint 是自定义中转时，`resolveProviderPresetForBuilder` 会落到 custom。需要在 `buildModelOptions` 和 `composeValue` 中做与 openai-platform 类似的兜底：套 `anthropic-official` 的 recommendedModels，否则 provider 能保存但搭建器模型下拉为空。

温度 UI 保持现状，但验收要覆盖：Opus 4.8 若显式设置 temperature，上游应返回明确 400 / 错误提示；后续可考虑按模型禁用采样参数。

### Phase 6.5 · chat route / draft test-chat 支持

#### 改 `app/api/agents/[id]/chat/route.ts`

- `supportsSystemRole` 加 `anthropic`，让工作流上下文走 system 语义；adapter 会抽到 `body.system`
- KB 检索 gate 加 `anthropic`，与 openai / zhipu 同属模型 API

#### 改 `app/api/admin/agent-drafts/[id]/test-chat/route.ts`

KB 检索 gate 同步加 `anthropic`，保证搭建器测试聊天和正式聊天口径一致。

### Phase 7 · 文档

新建：

- `upgrade/5.30up/5.30.1/方案-anthropic-原生协议接入-20260529.md`（本文档）
- `upgrade/5.30up/5.30.1/变更记录-20260529.md`（实施后写）

---

## 验收口径

### 自动化

- `npm run ci:typecheck` 通过
- `npm run ci:lint` 通过

### 人工 14 项（先在 dev DB 跑完 v44 migration）

1. **新增 anthropic provider** → API 管理弹窗厂商下拉里出现「Anthropic Claude（官方/中转）」；选中后 endpoint 字段为空、默认模型 `claude-haiku-4-5-20251001`、hint 显示 Kiro 警告
2. **填入中转 endpoint + key + model** → 保存 ✓
3. **「测试该模型」按钮** → 上游回流文本含「连接成功」→ ✓（如 Kiro 影响导致失败需 R1 修订探针逻辑）
4. **搭建器实测对话** → 选 anthropic provider + claude-haiku-4-5 → 发 "你好" → 流式响应正常（内容可能 Kiro 风格、忽略）
5. **token 用量记录**：
   ```sql
   SELECT model_used, prompt_tokens, completion_tokens, created_at
   FROM logs WHERE model_used LIKE 'claude%'
   ORDER BY created_at DESC LIMIT 5;
   ```
   字段有值（input_tokens / output_tokens 映射成功）
6. **额度扣减**：
   - 用 sonnet 跑一次 → `tenants.quota_used` 扣 8
   - 用 haiku 跑一次 → 扣 3
7. **错误冒泡**：故意填错 endpoint → 流式中途 error event → chat 落错误分支 + 用户看到明确错误（不静默截断）
8. **agent-builder 模型下拉**：选 anthropic provider（custom 中转 endpoint）→ 模型下拉里应出现 Haiku / Sonnet / Opus
9. **官方 endpoint 兼容**：admin 配 `https://api.anthropic.com/v1/messages` + 真 Anthropic key → 测试该模型 ✓（`x-api-key` 切换生效）
10. **Opus 模型可用**：选 Claude Opus 4.8 + 不配 temperature → 上游返 200
11. **显式 temperature 错误明确**：选 Claude Opus 4.8 后手动设置 temperature → 上游 400 / 错误提示明确，不静默失败
12. **故意 4xx 不重试**：填错 model id `claude-xxx-not-exist` → 立即返 400 + 错误明确（不浪费 3 次尝试）
13. **工作流上下文 → system 字段**：anthropic provider 在 wf 上下文中跑 → adapter 内部应将 wfCtxAsSystem 抽到 body.system
14. **KB 检索对 anthropic provider 生效**：搭建器选 anthropic + 绑定 KB → 测试聊天能命中检索（chat route + draft test-chat 口径一致）

### 回归

跑一次现有 OpenAI 兼容 provider 的搭建器对话，确认 dispatch 切到 anthropic case 不影响 default 分支。

---

## 不在本期范围

| 项目 | 原因 |
|---|---|
| **Kiro 注入消除** | 中转层行为，本平台代码改不了 · 用户已知接受 |
| **adaptive / extended thinking** | Opus 4.8 支持 adaptive thinking / effort，但本期只打通基础 messages 流式链路；深度推理参数下期单独设计 |
| **tool_use / function calling** | 本平台搭建器无 function calling 入口 |
| **多模态 image / document** | `ChatMessage.attachments` 字段目前仅 coze 用；anthropic adapter 本期直接 throw，避免 silent drop |
| **cache_control / prompt caching** | `cache_creation_input_tokens` / `cache_read_input_tokens` 本期不记到 logs，需要的话单独扩 columns |
| **batch / files / citations / memory APIs** | 扩展 API 本期不接 |
| **openaiCompatibleStream retry 策略优化** | plan agent R0 flag 它对 4xx 也重试浪费 token，但超 5.30.1 范围 · flag 进 backlog |

---

## 评审收口记录 · 小B 6 主要 + 4 次要项

R0 经小B评审，提出 6 主要 + 4 次要修订；R1 追加了收口节；R2 已把这些修订并入前文主实施段，下面仅作为评审记录保留。

### R1 #1 · Opus 版本：4.7 → **4.8**（已发布更新）

**WebSearch verify 2026-05-28**：[Anthropic 已正式发布 Claude Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8)
- API ID：`claude-opus-4-8`
- 定价：$5 / $25 per MTok（**与 4.7 同价**）
- 已上线 Claude API / Bedrock / Vertex AI / GitHub Copilot

R0 写"当前最新是 Opus 4.7"（基于 WebSearch 第一轮结果），实际 R1 verify 时 Opus 4.8 已 GA。

**R1 修订**：
- `migration_v44` 种子 `claude-opus-4-7 → claude-opus-4-8`
- preset recommendedModels `claude-opus-4-7 → claude-opus-4-8` + label 改 "Claude Opus 4.8（最强 · 2026-05-28）"
- 权重值 15 不变（同价）

### R1 #2 · adapter 文件位置：不新建 anthropic.ts，**内联在 index.ts**

**Explore verify**：[`lib/adapters/index.ts:469`](../../../lib/adapters/index.ts) `parseSSEStream` 是 `async function*`（**无 export**）。现有 5 个 adapter（cozeStream / difyStream / yuanqiStream / qingyanStream / openaiCompatibleStream）也都是 `async function*` 内联在 index.ts，无独立文件。

R0 写"新建 lib/adapters/anthropic.ts"，要复用 parseSSEStream 必须先重构 export 或拆 sse.ts 文件，**多动一个文件、违背最小变更原则**。

**R1 修订**：
- ❌ 删除"新建 `lib/adapters/anthropic.ts`"
- ✚ `anthropicStream` **内联在 `lib/adapters/index.ts`**（与 cozeStream 等同位置）
- Critical Files 清单文件数 9 → 8

### R1 #3 · 认证 header：按 endpoint host 自动判断

**事实**：[Anthropic 官方 API docs](https://docs.anthropic.com/en/api/getting-started) 明确使用 `x-api-key: <key>`。中转 `redcodeai.cn` 接受 `Authorization: Bearer` 是因为它在转发时自己换头。R0 只发 Bearer → admin 配 `api.anthropic.com` 时会 401。

**R1 修订**：

```ts
let isOfficial = false;
try {
  isOfficial = new URL(config.apiEndpoint).hostname === "api.anthropic.com";
} catch {}
const authHeaders = isOfficial
  ? { "x-api-key": config.apiKey }
  : { "Authorization": `Bearer ${config.apiKey}` };
```

无需引入 `auth_mode` 字段配置；中转地址保持 Bearer 兼容、官方 endpoint 自动切 x-api-key。用 hostname 精确判断，避免代理 URL 或 query/path 误判。

### R1 #4 · temperature：**不默认塞**

**事实**：Opus 4.7/4.8 不支持非默认采样参数（temperature / top_p / top_k），传了会 400。R0 默认 `temperature: 0.7` 会让 admin 选 Opus 时直接拒。

**R1 修订**：

```ts
const body: Record<string, unknown> = {
  model,
  messages: ...,
  max_tokens: ...,
  stream: true,
  ...(systemText ? { system: systemText } : {}),
  // 不默认塞 temperature；admin 在 modelParams 显式配置时透传
  ...(config.modelParams.temperature !== undefined
    ? { temperature: config.modelParams.temperature } : {}),
};
```

如 admin 给 Opus 配了 temperature → 上游返 400 错误（明确 surface），admin 看错误自己移除，比 silent fail 好。

### R1 #5 · max_tokens **不 clamp**

**事实**：[Anthropic 模型概览](https://docs.anthropic.com/en/docs/about-claude/models)：
- Sonnet/Haiku 上限 64k
- Opus 4.8 上限 128k

R0 clamp 8192 过于保守，让 admin 无法用长输出。

**R1 修订**：

```ts
max_tokens: (config.modelParams.max_tokens as number) ?? 2000,  // 不 clamp，admin 自己负责
```

由上游 enforce 上限；超限报错明确，admin 调整即可。

### R1 #6 · retry 4xx 实际仍重试 bug 修复

**bug**：R0 草图：

```ts
try {
  res = await fetch(...);
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    throw new Error(`...`);  // 这个 throw 在 try 内
  }
  ...
} catch (e) {
  lastErr = e;  // 4xx throw 在这里被抓，下次循环又试
  if (attempt < 2) await ...
}
```

4xx throw 被同一个 catch 捕获 → 继续 attempt → 浪费 token。

**R1 修订**：用 retryable break：

```ts
let res: Response | null = null;
let lastErr: Error | null = null;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    const r = await fetch(config.apiEndpoint, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.ok) { res = r; break; }
    const errText = await r.clone().text();
    lastErr = new Error(`Anthropic API ${r.status}: ${errText}`);
    // 4xx 非 429 → break 跳出循环，不重试
    if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
  } catch (e) {
    lastErr = e as Error; // 网络错误才进这里
  }
  if (attempt < 2) await new Promise(rr => setTimeout(rr, 300 * (attempt + 1)));
}
if (!res) throw lastErr ?? new Error("[anthropic] fetch failed");
```

逻辑：
- HTTP 200 → break，正常走 SSE
- HTTP 4xx 非 429 → 设 lastErr 后 break，直接 throw（不重试）
- HTTP 5xx / 429 → 设 lastErr，进入下次 attempt
- fetch 抛错（网络） → 进 catch，进入下次 attempt

### R1 #7 · attachments：throw 不 silent

R0 草图：

```ts
console.warn("[anthropic] 多模态 attachments 暂不支持，本期忽略");
// silent drop
```

silent drop → admin 上线后才发现"图没生效"。

**R1 修订**：

```ts
if (messages.some(m => m.attachments?.length)) {
  throw new Error("[anthropic] 多模态 attachments 暂不支持，请先移除或换 platform");
}
```

让 admin 在搭建器测试聊天时立即看到错误，而不是 silent 上线再爆。

### R1 #8 · 搭建器模型下拉对 anthropic platform 兜底（**新增文件改动**）

**事实**：[`app/admin/agent-builder/[id]/page.tsx:104-184`](../../../app/admin/agent-builder/%5Bid%5D/page.tsx) 的 `buildModelOptions`：
- 现有逻辑（5.29up Fix 4）：`r.kind === "custom" && provider.platform === "openai"` → 套 openai-official 推荐模型
- 其它 custom（含 `platform === "anthropic"` + 中转 endpoint）→ 返回空列表（line 173）

结果：admin 选 Anthropic provider（中转 endpoint 与 preset 不 match）时下拉里**没有 claude 模型可选**——能保存 provider 但搭建器用不了。

**R1 修订**：

```ts
// 现有 openai-platform 兜底之后追加：
const anthropicOfficial = all.find(p => p.code === "anthropic-official");
const anthropicOfficialModels = anthropicOfficial?.recommendedModels ?? [];

if (r.kind === "custom" && provider.platform === "anthropic" && anthropicOfficialModels.length > 0) {
  return anthropicOfficialModels.map(m => ({
    groupKey,
    groupLabel: baseLabel,
    optionValue: `${provider.id}::${m.value}`,
    optionLabel: stripModelDesc(m.label),
  }));
}
```

`composeValue` 同样的兜底逻辑也要加（与 openai-platform 处理对称）。

### R1 #9 · chat route 加 anthropic 到 supportsSystemRole + KB gate（**新增文件改动**）

**事实**：
- [`chat route line 450`](../../../app/api/agents/%5Bid%5D/chat/route.ts): `const supportsSystemRole = resolvedPlatform === "openai" || resolvedPlatform === "zhipu";`
- [`chat route line 417`](../../../app/api/agents/%5Bid%5D/chat/route.ts): KB 检索 gate 同 `(openai || zhipu)` 白名单
- 不加 anthropic → 工作流上下文 `wfCtxAsSystem` 被塞进 user prefix 而不是 system 字段（语义错位）；anthropic provider agent 跑 KB 检索被 gate 拦截

**R1 修订**：

```ts
// chat route line 450
const supportsSystemRole = resolvedPlatform === "openai"
  || resolvedPlatform === "zhipu"
  || resolvedPlatform === "anthropic"; // ✚

// chat route line 417
if ((resolvedPlatform === "openai" || resolvedPlatform === "zhipu" || resolvedPlatform === "anthropic")
    && !skipKbForThisTurn) {
  // KB 检索
}
```

anthropic adapter 内部抽 system → body.system 字段，是**原生 system 语义**，符合 supportsSystemRole=true 的预期；KB 注入 user prefix 流程对 anthropic 也兼容（messages[0].role=user 加 KB 前缀，与 openai 流程一致）。

### R1 #10 · draft test-chat 同步加 anthropic 到 KB gate（**新增文件改动**）

**事实**：[`test-chat line 141`](../../../app/api/admin/agent-drafts/%5Bid%5D/test-chat/route.ts) `if ((provider.platform === "openai" || provider.platform === "zhipu") && !skipKbForThisTurn)`，与 chat route 同口径。

**R1 修订**：白名单加 `anthropic`，与 R1 #9 chat route 同口径。

---

### R1 次要修订（4 项）

#### a. drop attachments 改为 throw

合并到 R1 #7，已落地。

#### b. supportsSystemRole 加 anthropic

合并到 R1 #9，已落地。

#### c. KB 检索 gate 加 anthropic

合并到 R1 #9 / #10，已落地。

#### d. max_tokens 不再硬 clamp 8192

合并到 R1 #5，已落地。

---

### R1 当时的 Critical Files 清单（已由文末 R2 最终清单取代）

| 文件 | R0 | R1 |
|---|---|---|
| `supabase/migration_v44_anthropic_platform.sql` 新建 | 含 claude-opus-4-7 种子 | **改 Opus 4.8** |
| `supabase/MIGRATIONS.md` 改 | v44 条目 | 不变 |
| ~~`lib/adapters/anthropic.ts` 新建~~ | 有 | **❌ 删除（内联到 index.ts）** |
| `lib/adapters/index.ts` 改 | dispatch | dispatch + **内联 anthropicStream**（按 R1 #2/#3/#4/#5/#6/#7 修订） |
| `lib/model-providers/presets.ts` 改 | platform union + preset | 同上 + **Opus 4.8 替换 4.7** |
| `app/api/admin/model-providers/route.ts` 改 | ALLOWED_PLATFORMS | 不变 |
| `app/api/admin/model-providers/[id]/route.ts` 改 | 同上 PATCH 段 | 不变 |
| **`app/admin/agent-builder/[id]/page.tsx` 改** | 不动 | **R1 #8 新增**：buildModelOptions + composeValue 加 anthropic platform 兜底 |
| **`app/api/agents/[id]/chat/route.ts` 改** | 不动 | **R1 #9 新增**：supportsSystemRole + KB gate 加 anthropic |
| **`app/api/admin/agent-drafts/[id]/test-chat/route.ts` 改** | 不动 | **R1 #10 新增**：KB gate 加 anthropic |
| `upgrade/5.30up/5.30.1/方案-anthropic-原生协议接入-20260529.md` 改 | R0 | **追加 R1 收口节** |

### R1 完整 adapter 草图（取代 R0 草图）

```ts
async function* anthropicStream(messages: ChatMessage[], config: AdapterConfig): AsyncGenerator<string> {
  // R1 #7 · attachments 改 throw
  if (messages.some(m => m.attachments?.length)) {
    throw new Error("[anthropic] 多模态 attachments 暂不支持，请先移除或换 platform");
  }

  // 抽 system
  const systemMessages = messages.filter(m => m.role === "system");
  const otherMessages = messages.filter(m => m.role !== "system");
  const systemText = systemMessages.map(m => m.content).join("\n\n");

  // R1 #4/#5 · 不默认塞 temperature；max_tokens 不 clamp
  const model = (config.modelParams.model as string) ?? "claude-haiku-4-5-20251001";
  const body: Record<string, unknown> = {
    model,
    messages: otherMessages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: (config.modelParams.max_tokens as number) ?? 2000,
    stream: true,
    ...(systemText ? { system: systemText } : {}),
    ...(config.modelParams.temperature !== undefined
      ? { temperature: config.modelParams.temperature } : {}),
  };

  // R1 #3 · 按 endpoint host 切认证 header
  let isOfficial = false;
  try {
    isOfficial = new URL(config.apiEndpoint).hostname === "api.anthropic.com";
  } catch {}
  const authHeaders: Record<string, string> = isOfficial
    ? { "x-api-key": config.apiKey }
    : { "Authorization": `Bearer ${config.apiKey}` };

  // R1 #6 · 智能 retry（4xx 非 429 不重试）
  let res: Response | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: { ...authHeaders, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { res = r; break; }
      const errText = await r.clone().text();
      lastErr = new Error(`Anthropic API ${r.status}: ${errText}`);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;
    } catch (e) {
      lastErr = e as Error;
    }
    if (attempt < 2) await new Promise(rr => setTimeout(rr, 300 * (attempt + 1)));
  }
  if (!res) throw lastErr ?? new Error("[anthropic] fetch failed");

  // SSE 解析（与 R0 设计一致）
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
          outputTokens = obj.usage?.output_tokens ?? outputTokens;
          return null;
        }
        if (event === "error") {
          throw new Error(`Anthropic stream error: ${obj.error?.type ?? "unknown"} - ${obj.error?.message ?? ""}`);
        }
      } catch (e) {
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
```

### R1 验收口径补充（R2 已并入主验收口径）

8. **agent-builder 模型下拉**：选 anthropic provider（custom 中转 endpoint）→ 模型下拉里应出现 Haiku / Sonnet / Opus（R1 #8 兜底生效）
9. **官方 endpoint 兼容**：admin 配 `https://api.anthropic.com/v1/messages` + 真 Anthropic key → 测试该模型 ✓（R1 #3 x-api-key 切换生效）
10. **Opus 模型可用**：选 Claude Opus 4.8 + 不配 temperature → 上游返 200（R1 #1 + #4 联合生效）
11. **故意 4xx 不重试**：填错 model id `claude-xxx-not-exist` → 立即返 400 + 错误明确（不浪费 3 次尝试）
12. **工作流上下文 → system 字段**：anthropic provider 在 wf 上下文中跑 → adapter 内部应将 wfCtxAsSystem 抽到 body.system（R1 #9 supportsSystemRole 生效）
13. **KB 检索对 anthropic provider 生效**：搭建器选 anthropic + 绑定 KB → 测试聊天能命中检索（R1 #9 / #10 KB gate 生效）

---

## R2 二审消歧结果

### 你 R0 提的 6 主要 + 4 次要点，现在分别在哪

| 你的编号 | 处理位置 | 摘要 |
|---|---|---|
| #1 搭建器选不到模型 | R1 #8 + Phase 6 改 page.tsx | buildModelOptions 加 `platform === "anthropic"` 兜底套 anthropic-official 推荐模型 |
| #2 parseSSEStream 未 export | R1 #2 + Phase 1 调整 | anthropic adapter 内联在 index.ts，与 5 个现有 adapter 同风格 |
| #3 认证 header | R1 #3 + adapter 草图 | 按 endpoint host 自动判断 x-api-key / Bearer |
| #4 Opus 4.8 已发布 | R1 #1 + Phase 0 / 5 | migration 种子 + preset 都改 claude-opus-4-8 |
| #5 temperature 默认会 400 | R1 #4 + adapter 草图 | 不默认塞 temperature；admin 显式配置时透传 |
| #6 retry 4xx bug | R1 #6 + adapter 草图 | 用 retryable break 显式分流 |
| 次要 a · drop attachments silent | R1 #7（合并 #7） | 改 throw |
| 次要 b · supportsSystemRole | R1 #9（合并 #9） | 加 anthropic |
| 次要 c · KB 检索 gate | R1 #9 + #10（合并） | 加 anthropic 到 chat + test-chat |
| 次要 d · max_tokens 8192 偏保守 | R1 #5（合并） | 不 clamp |

### 原 R0 的 4 决策点（仍开放，未变）

#### 决策点 1 · 权重值 3/8/15

- 当前选 haiku=3 / sonnet=8 / opus=15（plan agent R0 改进后；Opus 4.8 与 4.7 同价，权重 15 不变）
- 替选：5/12/25（成本压制更紧）/ 2/6/15（更鼓励 Haiku 用量）

#### 决策点 2 · preset endpoint 默认值

- 当前选「留空 + hint 给两个备选 URL」
- 替选：硬编码官方 / 硬编码中转

#### 决策点 3 · model id 带日期 vs 短名

- 当前选「带日期 + 短名混用」：Haiku 带日期、Sonnet 4.6 / Opus 4.8 短名
- 实施前需 WebSearch 再 verify Sonnet/Opus 4.8 是否有日期版本广泛使用

#### 决策点 4 · Kiro 风险 UI 强度

- 当前选 A · preset hint 文字里写明 ⚠️
- 替选 B · 搭建器选 anthropic provider 时弹 dialog 确认 ack
- 替选 C · 不提

### R1 新增决策点 5（可选）

#### 决策点 5 · agent-builder buildModelOptions 兜底策略

- 当前选 R1 #8 · 与 openai-platform 对称——`platform === "anthropic" + custom endpoint` 套 anthropic-official 推荐模型
- 替选 · 改成"按 platform 找 default preset"通用 helper，openai / anthropic / 未来 platform 都用一个公共函数（更优雅但超 5.30.1 范围，flag 进 backlog）

R2 已把二审意见并入主实施段，可进入 Phase 0 实施。

---

## 估时

| 阶段 | 时间 |
|---|---|
| 方案文档（本次） | ~30 分钟 |
| 小B 评审 + R1 修订 | ~30-60 分钟 |
| 后端实施（adapter 主体 + dispatch + 路由白名单 + preset + 搭建器/KB gate） | ~2 小时 |
| 测试探针 verify + 前端 verify | ~30 分钟 |
| typecheck + lint + commit + 写变更记录 | ~30 分钟 |
| 用户人工实测 14 项 | ~30-45 分钟 |
| **总计** | **~4-5 小时** |

---

## Critical Files 索引（R2 最终）

实施时要修改 / 新增的文件：

| 文件 | 类型 | 改动 |
|---|---|---|
| `supabase/migration_v44_anthropic_platform.sql` | 新建 | platform CHECK 扩 + model_quota_weights 种子（含 Opus 4.8） |
| `supabase/MIGRATIONS.md` | 改 | 加 v44 索引条目 |
| `lib/adapters/index.ts` | 改 | dispatch 加 `anthropic` case + 内联 `anthropicStream` |
| `lib/model-providers/presets.ts` | 改 | platform union 扩 + LLM_PRESETS 加 Anthropic preset（Opus 4.8） |
| `app/api/admin/model-providers/route.ts` | 改 | ALLOWED_PLATFORMS + CATEGORY_PLATFORMS |
| `app/api/admin/model-providers/[id]/route.ts` | 改 | 同上 PATCH 段 |
| `app/admin/agent-builder/[id]/page.tsx` | 改 | `platform === "anthropic"` custom endpoint 模型下拉兜底 + composeValue 兜底 |
| `app/api/agents/[id]/chat/route.ts` | 改 | supportsSystemRole + KB gate 加 `anthropic` |
| `app/api/admin/agent-drafts/[id]/test-chat/route.ts` | 改 | KB gate 加 `anthropic` |
| `upgrade/5.30up/5.30.1/方案-anthropic-原生协议接入-20260529.md` | 改 | **本文档，R2 已消歧** |
| `upgrade/5.30up/5.30.1/变更记录-20260529.md` | 实施后新建 | 变更记录 |
