# 体验版 3 智能体迁入正式版方案

**文档日期**：2026-04-30
**适用范围**：把 `lib/trial-agents.ts` 中的 agent_001 / agent_002 / agent_003 三条配置作为正常 `agents` 表记录入库，使其在 `/admin/agents` 后台可见可管，主流程聊天扣 tenant 配额
**文档目的**：定义本次迁入的最小变更集，明确"做什么 / 不做什么"，以便用户后续在后台手动完成分类 / 工作流 / 租户绑定

---

## 一、需求原文

> "这三个智能体移入正式版，使用是扣额度的，加密可以做，绑定工作流需要在后台绑定，希望这三个智能体能够进入智能体管理中。以后我也想看看能不能我们输入 api token 和 bot id 就能直接在后台接入新的智能体了。测试版先不急着下线。"

拆解 = 5 个动作：
1. 三条 trial agent 写入 `agents` 表
2. 走主链路扣额度（`/api/agents/[id]/chat` + `supabase/rpc.sql` 的扣额度 RPC）
3. API token 使用与 `lib/crypto.ts` 完全等价的 AES-256-GCM 逻辑加密入 `api_key_enc`
4. **不**自动绑定工作流（用户后台 `/admin/workflows` 手动绑）
5. 体验版 `/trial`、`lib/trial-agents.ts`、`.env.local` 的 `TRIAL_AGENT_*` **保留不动**

未来需求（"后台输入 token + bot id 直接接入新 agent"）= 阶段二需求，本方案不实现。

---

## 二、关键事实（已核对）

> 注：agents 表的真实结构 = `supabase/schema.sql` 基础列 + 累积的 `migration_v*.sql` 增列。
> 例如 `agent_type` / `external_url` 来自 `migration_v2.sql`，`agent_categories` 多对多表来自 `migration_v15.sql`。
> 看 schema.sql 单文件会得到不完整的字段集，以下事实以"迁移后的实际线上库"为准。

| 关注点 | 现状 | 出处 |
| --- | --- | --- |
| agents 表必填列 | `agent_code(UNIQUE)`、`name`、`platform`，其余有默认值 | `supabase/schema.sql:51-63` |
| agents 表扩展列 | `agent_type ('chat'\|'external')`、`external_url`、其它 | `migration_v2.sql:8-16` 等 |
| 加密 | `encrypt(plaintext)` AES-256-GCM，密钥来自 `JWT_SECRET` | `lib/crypto.ts:12` |
| Admin POST 接口 | `POST /api/admin/agents` 接受 `apiKey` 明文，内部 `encrypt(apiKey)` 入库 | `app/api/admin/agents/route.ts:102-142` |
| 后台 UI 字段 | `agent_type` 限 `chat`/`external`、可选 `categoryIds`、`apiEndpoint`、`apiKey`、`modelParams`（JSON） | 同上 schema |
| 可见性主口径 | `resource_permissions(resource_type='agent')`；`tenant_agents` 是旧兼容表，不作为本方案口径 | `app/api/admin/agents/route.ts:35-46` |
| Coze 适配器读 bot_id | 优先 `config.modelParams.bot_id`，否则用 `agentCode`（业务编号） | `lib/adapters/index.ts cozeStream` |
| Yuanqi 适配器读 assistant_id | 优先 `config.modelParams.assistant_id`，否则用 `agentCode` | `lib/adapters/index.ts yuanqiStream` |
| trial 三条配置来源 | `lib/trial-agents.ts` 读 6 个 env：`TRIAL_AGENT_001_BOT_ID/_API_TOKEN`、`TRIAL_AGENT_002_BOT_ID/_API_TOKEN`、`TRIAL_AGENT_003_ASSISTANT_ID/_API_KEY` | 该文件 |
| `.env.local.example` | 仅有 001/002 示例，缺 003 两条；不在本次范围更新，但运行环境必须实际具备这 6 个变量 | 该文件 |
| 主页入口约束 | 阶段一只显示工作流绑定的 agents → 这 3 条必须由你后台手动绑到某条 workflow 才会在主页出现 | 4.30up 阶段一方案 |

---

## 三、迁入实施

### 1. 字段映射表

| 字段 | agent_001 | agent_002 | agent_003 |
| --- | --- | --- | --- |
| `agent_code` | `AGT-COZE-001` | `AGT-COZE-002` | `AGT-YUANQI-001` |
| `name` | 测试对话智能体 | 前哨-知识库入库整理 | 测试对话智能体2 |
| `description` | 用于测试智能体问答能力 | 辅助梳理与整理知识库入库内容 | 用于测试元器（腾讯）智能体问答能力 |
| `platform` | `coze` | `coze` | `yuanqi` |
| `agent_type` | `chat` | `chat` | `chat` |
| `api_endpoint` | `https://api.coze.cn/v3/chat` | 同 | `https://yuanqi.tencent.com/openapi/v1/agent/chat/completions` |
| `api_key_enc` | `encrypt(TRIAL_AGENT_001_API_TOKEN)` | `encrypt(TRIAL_AGENT_002_API_TOKEN)` | `encrypt(TRIAL_AGENT_003_API_KEY)` |
| `model_params` | `{ bot_id: TRIAL_AGENT_001_BOT_ID }` | `{ bot_id: TRIAL_AGENT_002_BOT_ID }` | `{ assistant_id: TRIAL_AGENT_003_ASSISTANT_ID }` |
| `enabled` | `true` | `true` | `true` |
| `category_id` | NULL（你后台再设） | NULL | NULL |
| `external_url` | `''` | `''` | `''` |

**agent_code 命名规则**：`AGT-{平台大写}-{序号}`，与表里现存数据风格保持一致；不直接复用 trial 的 `agent_001` 命名（避免和 trial 模块字面重复造成困惑）。

### 2. 实施方式：一次性 .mjs 脚本（不引新依赖）

**为什么用脚本不用 SQL**：
- token 是密文，需要 `encrypt()` 才能正确入库
- 把密文手抄进 SQL 文件会污染 git history
- 脚本可以幂等（按 `agent_code` 分流 INSERT / UPDATE），重跑安全

**为什么用 .mjs 不用 .ts**：
- 当前 `package.json` 没有 `tsx`、没有 `dotenv`
- Node 20+ 原生支持 `--env-file=.env.local`，无需 dotenv
- encrypt 仅 8 行 AES-256-GCM 代码，可在 .mjs 内联，无需引入 `lib/crypto.ts` TS 模块
- 不动 `package.json`、不动 `package-lock.json`

**脚本路径**：`scripts/migrate-trial-agents.mjs`

**脚本职责**：
- 走 Node 原生 `--env-file=.env.local` 加载环境变量
- 读 6 个 `TRIAL_AGENT_*` + `JWT_SECRET` + `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`；任一缺失立刻 abort
- 内联 AES-256-GCM 加密函数（与 `lib/crypto.ts` 完全等价）
- 用 supabase-js + service_role key **两阶段**写入（避免 upsert 覆盖手动改过的列）：
  1. 先 SELECT 现有 agent_code，分成"已存在 / 不存在"两组
  2. 不存在 → INSERT 全列（`agent_type='chat'`、`external_url=''`、其它列默认值由表负责）
  3. 已存在 → UPDATE **仅** `name / description / platform / api_endpoint / api_key_enc / model_params` 6 列；
     **不动** `agent_type / external_url / enabled / category_id`（保护后台手动改过的展示类型 / 外链 / 启停 / 分类）
- 跑完打印 3 行的 id (UUID) + agent_code + enabled + category_id 表格
- 末尾打印一条复核 SQL，方便复制到 Supabase Studio 验证

**运行方式**：
```bash
node --env-file=.env.local scripts/migrate-trial-agents.mjs
```

### 3. SQL 不改

不写 `migration_v*.sql`、不动表结构；本次纯数据迁入，跑脚本即可。

### 4. 后续手动操作（脚本之外，由你在后台完成）

按你的口径，下面这些**不在脚本里**：
- 在 `/admin/agents` 编辑这 3 条，分别选分类（可选）
- 在 `/admin/workflows` 创建一条工作流（或编辑已有的），添加 step 时把 `agent_id` 选成这 3 条之一
- 如需限定可见性 / 授权给特定组织或用户，使用后台现有"权限/分配组织"能力，落到 `resource_permissions` 表（`resource_type='agent'`）
  - **不**写 `tenant_agents`（旧兼容表，前台可见性不再以它为准）
  - 阶段一主页是工作流主导，可见性主要由 workflow 自身的 `visible_to` 控制；只要工作流可见且 step 绑定了这 3 条 agent，主页入口就来自 `/api/workflows`

---

## 四、扣额度链路（已天然满足，无需改动）

主流程聊天接口 `/api/agents/[id]/chat`（参考 `CLAUDE.md`）已经做了：
1. 读 `agents.api_key_enc` → `decrypt()` → 给 adapter
2. 读 `agents.model_params` → 给 adapter（`bot_id` / `assistant_id` 落到此处）
3. 调 `streamChat()` → 流式返回
4. 调 `supabase/rpc.sql` 扣 1 次额度

只要这 3 条新 agent 落进 `agents` 表，主流程自动覆盖。

---

## 五、改动范围

### 允许改的目录 / 文件

| 路径 | 改动 |
| --- | --- |
| `scripts/migrate-trial-agents.mjs` | **新建**（一次性 .mjs 脚本，Node 原生 ESM，不依赖 tsx） |

### 禁止改的目录 / 文件

| 路径 | 禁改原因 |
| --- | --- |
| `lib/trial-agents.ts`、`lib/trial-text-extract.ts` | 体验版保留不下线 |
| `app/trial/**`、`app/api/trial/**` | 体验版保留不下线 |
| `.env.local` 的 `TRIAL_AGENT_*` 6 个变量 | 体验版仍依赖 |
| `supabase/schema.sql` 与所有 `migration_*.sql` | 不改表结构 |
| `lib/crypto.ts`、`lib/adapters/**`、`lib/db.ts` | 复用现成机制 |
| `app/api/admin/agents/**` | POST/GET/PATCH 接口已支持本次需求 |
| `app/admin/agents/**` | 后台 UI 不改 |
| `app/api/agents/[id]/chat/**` | 主流程不动 |
| `app/page.tsx`、`app/agents/[id]/**` | 不动前端 |

---

## 六、验收

| 编号 | 验收点 | 验法 |
| --- | --- | --- |
| M1 | 跑脚本输出 3 行 agent_code + UUID，无错误 | 终端 |
| M2 | `/admin/agents` 列表里能看到 3 行（按 agent_code 搜） | 后台 UI |
| M3 | 列表里 api_key 显示脱敏串（`••••••••••••XXXX`），明文不暴露；末 4 位是密文末 4 位（与原 token 末 4 位无关，符合现有 mask 实现） | 后台 UI |
| M4 | 编辑某条 → 修改 description 保存 → 列表回写正确 | 后台 UI |
| M5 | 在 `/admin/workflows` 编辑某条工作流，step 的 agent 下拉里能选到这 3 条 | 后台 UI |
| M6 | 把任一 agent 加进某 workflow step，主页选该 workflow → 详情下"智能体展示"卡能看到该 agent | 主页 |
| M7 | 点该 agent 卡 → `/agents/[id]` → 发一条消息 → 流式返回；聊天页 quota 显示 -1，或 DB `tenants.quota_used` +1（主页 quota 不一定实时刷新） | 浏览器 + DB |
| M8 | trial `/trial` 仍可正常使用 3 个 agent，未受影响 | 浏览器 |
| M9 | 重跑脚本（幂等）→ 不创建新行，仅更新 6 列；`agent_type / external_url / enabled / category_id` 保持不变 | DB 计数 + diff |

---

## 七、明确不做

- 不动 trial 模块、不删 trial env、不删 trial 表
- 不写 SQL migration 文件
- 不改 admin 后台 UI（包括"新增 agent 表单"）
- 不自动绑定 category / workflow，也不写 `tenant_agents` / `resource_permissions`
- 不修改加密算法
- 不改 adapter
- 不引新依赖（不加 tsx / dotenv）
- 不实现"后台输入 token + bot_id 直接接入"的扩展功能（属阶段二）
- 不写"trial → formal 数据双向同步"逻辑（trial 自有 trial_messages，与 agents 表无关）

---

## 八、已锁定的口径（不再询问）

1. **agent_code 命名**：`AGT-COZE-001` / `AGT-COZE-002` / `AGT-YUANQI-001`
2. **upsert 字段保守**：已存在记录只更新 `name / description / platform / api_endpoint / api_key_enc / model_params` 6 列；`agent_type / external_url / enabled / category_id` 保留原值
3. **环境**：开发即生产，目标 Supabase = 线上 Supabase；不加额外环境确认提示
4. **脚本末尾打印复核 SQL**：是
5. **可见性**：本脚本不做任何组织授权；后台手动用现有"权限/分配组织"能力，落到 `resource_permissions(resource_type='agent')`
