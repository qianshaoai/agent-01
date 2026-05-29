### 5.30up 方案 · org_admin 获得 API + 知识库管理权限（统一 ownership 模型）

日期：2026-05-29
作者：小A
状态：**R2 已收口 6 + 2 项小B 二审意见，待三审**（未动代码 / DB / 配置）
版本：R2（2026-05-29 三改）
依据：用户 2026-05-29 提出 ——

> 1. 赋予组织管理员 API 管理权限，但只能看到 super/system 设置的 + 自己所在组织的 API，只能改自己组织新增的
> 2. 赋予组织管理员知识库管理权限，规则同上
> 3. 两块方案应该是同一模式，并行开发

---

## 背景与目标

### 现状（recon 结论）

**`model_providers`**（v35 + v37 + v38 加 category）

- 列：`id / provider_code (UNIQUE) / name / platform / category / api_endpoint / api_key_enc / default_model / default_params / enabled / created_by / created_at / updated_at`
- **无 ownership 字段**；现有所有行都是 super/system 建的"平台公共"
- RLS 禁用，应用层鉴权

**`knowledge_bases`**（v38）

- 列：`id / name / description / embedding_model / status / created_by / created_at / updated_at`
- **无 ownership 字段**；同上
- 关联表 `kb_documents`（FK kb_id → knowledge_bases）、`kb_chunks`（FK kb_id + document_id）、`agent_knowledge_bases`（agent ↔ kb）

**当前 5 个 API 管理 endpoint 的 admin 闸门**

| 路由 | 当前口径 |
|---|---|
| `GET  /api/admin/model-providers` | super + system + org_admin **全可见**（sanitize 脱敏）|
| `POST /api/admin/model-providers` | **只 super_admin** 可建 |
| `GET    /api/admin/model-providers/:id` | super + system；org_admin 403 |
| `PATCH  /api/admin/model-providers/:id` | **只 super_admin** |
| `DELETE /api/admin/model-providers/:id` | **只 super_admin** |
| `POST   /api/admin/model-providers/:id/test` | super + system；org_admin 403 |

**当前 4 类 KB endpoint 的 admin 闸门**

| 路由 | 当前口径 |
|---|---|
| `GET /api/admin/knowledge-bases` | super + system；org_admin 全 403（`denyKbAdmin`）|
| `POST /api/admin/knowledge-bases` | 同上 |
| `GET / PATCH / DELETE /api/admin/knowledge-bases/:id` | 同上 |
| `GET /api/admin/knowledge-bases/:id/documents` 及上传 | 同上 |
| `DELETE /api/admin/knowledge-bases/:id/documents/:docId` 及重建索引 | 同上 |

### 目标

1. **org_admin 可见范围**：平台公共资源（super/system 建的）+ 本组织新增的
2. **org_admin 可写范围**：仅本组织新增的（read-only on 平台公共 / 别 org 的）
3. **API 管理与知识库共用一套 ownership 机制**，确保口径完全一致、可并行开发
4. **后端强制校验**，前端只是 UX 辅助（灰按钮 / 标识徽章），不是安全边界

---

## 统一 ownership 模型（核心设计）

### Schema 决策 · `tenant_code TEXT NULL`

两张表（`model_providers` + `knowledge_bases`）都加同名字段：

```
tenant_code TEXT NULL
```

| 取值 | 含义 | 可见 | 可写 |
|---|---|---|---|
| `NULL` | 平台公共（super / system 建的）| 全员可见 | 仅 super / system |
| `'ORG-XYZ'` | 某组织建的 | super / system + 该 org 内 admin 可见 | super / system + 该 org_admin |

**KB 当前路由的现成基础（5.19up–5.28up 已落）：**

- 路由层 4 条都在、handler 健全（GET list / POST / GET detail / PATCH / DELETE，+ `[id]/documents` 上传 / `[id]/documents/[docId]` 删除重建）
- 文档存储 / 异步 ingest / 引用反查 / 引用阻断删除 全部已有
- B 半要叠的就是把 `denyKbAdmin` 那一道闸换成 `scoped-access.ts` 的 4 个 helper，工作量与 A 半对称

**为什么不是 `owner_role` enum + `owner_tenant_code`：**
- 多一个字段没增加表达力（NULL 就够区分"平台 vs 组织"了）
- enum 维护成本高，迁移更脆
- 现有 `admins.tenant_code` 已是 TEXT，复用同口径

**为什么不加 FK 到 `tenants(code)`：**
- 项目惯例：`admins.tenant_code` / `users.tenant_code` 都没加 FK，软引用
- 新加 FK 与现状不一致，且 `ON DELETE SET NULL` 在 tenant 解散时会让资源静默归"平台公共"——比留着指向已删 tenant 让 super_admin 手动清理更危险
- 保持软引用 + 应用层校验

**存量数据回填**

- 一次性 SQL `UPDATE` 把所有现有行的 `tenant_code` 置 NULL（继承"平台公共"语义）
- 不破坏任何现有行为

**索引**

- `tenant_code` 单列 BTREE（org_admin list 高频过滤）
- 不加 `(tenant_code, enabled)` 复合（enabled 已有单独索引，组合查询走两索引交即可）

### `provider_code` UNIQUE 怎么办

`model_providers.provider_code` 当前 **全局 UNIQUE**。两个 org 都想叫 `openai-x` 会冲突。

**口径不变（保持全局 UNIQUE）：**

- provider_code 是给运维 / 审计读的业务编号，全局唯一更易追溯
- 创建时撞名 → 友好错误"已存在"（已有逻辑）
- 业务上 org 应在自己的命名前缀里加组织码（如 `org-acme-openai`）
- 避免：把 UNIQUE 改成 `(tenant_code, provider_code)` —— 跨 org 查找历史时同名混淆，运维体验差

知识库 `name` 不是 UNIQUE，无此问题。

### RLS 仍禁用

与现状一致。所有访问控制走应用层。

---

## 共用代码 · `lib/scoped-access.ts`

新增工具库，强制所有写接口走它，禁止内联 `if (admin.role === ...)`：

```ts
// 伪代码 / 签名约定
export type ScopedResource = { tenant_code: string | null };

/** GET list 查询追加 ownership 过滤；super/system 不动 */
export function applyListScope<Q>(
  admin: AdminPayload,
  query: Q,                     // Supabase QueryBuilder
): Q;

/** GET detail / PATCH / DELETE 前的读权限校验 */
export function canReadRow(admin: AdminPayload, row: ScopedResource): boolean;

/** PATCH / DELETE 前的写权限校验 */
export function canWriteRow(admin: AdminPayload, row: ScopedResource): boolean;

/** POST 创建时强制注入 tenant_code（org_admin 强 set 自己的，super/system 沿用 payload）*/
export function resolveCreateOwnership(
  admin: AdminPayload,
  payload: Partial<ScopedResource>,
): { tenant_code: string | null };

/** PATCH 时阻止 org_admin 改 ownership；返回净化后的 patch */
export function sanitizeUpdatePatch(
  admin: AdminPayload,
  patch: Record<string, unknown>,
): Record<string, unknown>;     // 剥离 tenant_code 字段（org_admin）
```

**口径细则（R2 §2 · org_admin 缺 tenantCode 全部 fail-closed）：**

- `applyListScope(admin, query)`：
  - super / system → 原 query 不动
  - org_admin + 有 tenantCode → `query.or('tenant_code.is.null,tenant_code.eq.<admin.tenantCode>')`
  - **org_admin + 缺 tenantCode → 返回 impossible query**（如 `eq("id", "00000000-0000-0000-0000-000000000000")`），且 route 层应拒绝（见下方 §双闸 模型）

- `canReadRow`：
  - super / system → true
  - org_admin + 有 tenantCode → `row.tenant_code === null || row.tenant_code === admin.tenantCode`
  - **org_admin + 缺 tenantCode → false**（连平台公共也不让读，体现"未绑组织 = 待修复账号"语义；R2 §2）

- `canWriteRow`：
  - super / system → true（**注：这里只判归属，不判角色白名单；后者由路由层做，见下方 §双闸 模型**）
  - org_admin + 有 tenantCode → `row.tenant_code === admin.tenantCode`（NULL 排除）
  - **org_admin + 缺 tenantCode → false**（R2 §2）

- `resolveCreateOwnership`：
  - super / system → 可在 payload 显式传 `tenant_code`（赋给某 org，**但必须先经 `validateTenantCode` 校验存在性 · 见 R2 §6**）；没传则 NULL（平台公共）
  - org_admin + 有 tenantCode → **无论 payload 怎么写，强制设为 `admin.tenantCode`**（防越权）
  - **org_admin + 缺 tenantCode → 抛错 `SCOPE_ADMIN_NO_TENANT`**，路由层捕获返 403（R2 §2 · 防变成"平台公共"）

- `sanitizeUpdatePatch`：
  - super / system → patch 不动（可改 tenant_code，但若改为非 NULL 需先 `validateTenantCode`）
  - org_admin → 若 patch 里有 `tenant_code` 字段，**剥离**（防把自己的资源转给别 org / 改成 NULL）

- **`validateTenantCode(code: string): Promise<boolean>` （R2 §6 新增）**：
  - 异步查 `tenants.code` 存在
  - super/system 显式给资源指定 `tenant_code` 时**路由层先调它**，不存在 → 422 + 明确报错
  - org_admin 创建资源时也要校验 `admin.tenantCode` 存在；不存在 → 403 + "组织不存在或已失效，请联系平台管理员"
  - 原因：`getActiveAdmin()` 只从 `admins/users` 读取 `tenant_code`，不保证 `tenants.code` 仍存在；组织被删后不能继续创建孤儿资源
  - 单独 helper 原因：5 个核心函数保持纯逻辑（同步、可单测），DB 校验单独拆出

**单测覆盖**（先于业务代码写）：

- 5 个核心函数 × 5 种身份（super / system / org_admin 同 org / org_admin 别 org / **org_admin 缺 tenantCode**）= **25 个用例**
- `validateTenantCode`：2 个用例（存在 / 不存在）
- `requireWriteAccess`：6 个用例（API 写拒 system_admin、KB 写放 system_admin、org_admin 缺 tenantCode、org_admin stale tenantCode、org_admin 正常、super 正常）
- **总计 33 个 scoped-access 单测**（R2 修正 R1 的 20 笔误）

---

## 权限矩阵（R1 收口：API / KB 两套不同口径，不放权 system_admin）

⚠️ **小B R1 指出**：原矩阵把 system_admin 写成 API 全写，但 [model-providers/route.ts:10](../../app/api/admin/model-providers/route.ts) 现行口径是 "super_admin 全部操作；system_admin 仅查看 + 测试连通性"。本期是给 org_admin 加权限，**不顺带放权 system_admin**。两类资源矩阵必须分开列。

### API 管理 model_providers（system_admin 不放权）

| 操作 | super_admin | system_admin | org_admin |
|---|---|---|---|
| **List** | 全部 | 全部 | `tenant_code IS NULL OR = 自己 tenantCode` |
| **Get detail** | 全部 | 全部 | 同上（404 屏蔽，见下） |
| **Create** | 可选 `tenant_code` | ❌ 仍无权 | 强制 `tenant_code = 自己`；**embedding category 例外 → 拒**（见 R1 收口 §embedding） |
| **Update** | 任意改，含 `tenant_code`（转让前先扫引用，见 §ownership 转让） | ❌ 仍无权 | 仅 own；patch 中 `tenant_code` 自动剥离 |
| **Delete** | 任意删（先扫引用阻断） | ❌ 仍无权 | 仅 own |
| **Test** | 任意测 | 任意测 | 仅 own |

### 知识库 knowledge_bases（system_admin 沿用现状·全写）

| 操作 | super_admin | system_admin | org_admin |
|---|---|---|---|
| **List** | 全部 | 全部 | `tenant_code IS NULL OR = 自己 tenantCode` |
| **Get detail** | 完整 | 完整 | **不含别 org agent 引用名**（仅返计数，见 R1 收口 §KB 引用泄漏） |
| **Create** | 可选 `tenant_code` | 可选 `tenant_code` | 强制 `tenant_code = 自己` |
| **Update** | 任意改，含 `tenant_code`（转让前先扫引用） | 任意改 | 仅 own；patch 中 `tenant_code` 自动剥离 |
| **Delete** | 任意删（先扫引用） | 任意删 | 仅 own |
| **文档（上传 / 删除 / 重建索引）** | 任意 | 任意 | KB 必须 `canWriteRow` 通过 |

**Get detail 的 404 vs 403 决策：**

- org_admin 访问"不存在的 id"或"存在但不属于自己/不属于公共"——统一返 404
- 不区分"无权"和"不存在"——防 id 探测（攻击者通过 403 vs 404 差异枚举别 org 资源 id）
- super / system 仍区分 404 与 403（他们没有探测担忧）

---

## R1 收口 · 小B 评审 7 项

R0 初稿主要漏在「权限边界 ≠ 资源边界」——只想到改 list/CRUD，没想到 draft / test-chat / embedding / audit / 引用泄漏 / 转让 / 导航 这些**与 ownership 相关的次要路径**也全要收口。下面按小B 编号逐项给方案。

### §1 · system_admin 不放权（已在矩阵中处理）

见上方两套矩阵：API 管理 system_admin 保持"仅查/测"，KB 管理保持"全写"。**本期不动 system_admin 的现有口径**。

### §2 · 草稿 / 测试聊天链路也要 canReadRow（核心收口）

只补 `publish/route.ts` 不够——org_admin 可以在草稿层先污染 provider_id / knowledge_base_ids，再通过 test-chat 真打上游接口（消耗别 org provider 的额度 + 用别 org 的 KB 做检索）。**4 条链路全部收口：**

| 路由 | 当前能做什么 | 补什么 |
|---|---|---|
| `agent-drafts/route.ts` POST | 创建草稿可塞任意 provider_id / builder_config.knowledge_base_ids | `canReadRow` 校验入参 ids（provider + KB），任一不可见 → 422 |
| `agent-drafts/[id]/route.ts` PATCH | 同上（既能创建也能改）| 同上 |
| `agent-drafts/[id]/duplicate/route.ts` POST | 复制别人的 draft 时 provider_id / kb_ids 会跟着进来 | duplicate 时按**当前 admin** 视角重新校验；不可见的 → 复制时降级为 null / 从 array 移除 + toast 提示 admin "复制时 N 个不可见资源已剥离" |
| `agent-drafts/[id]/test-chat/route.ts` POST | 加载 provider 真打上游 + 用 KB 做检索 | provider `canReadRow` 失败 → 403；KB ids 用 `canReadRow` 过滤后再传给检索（与 publish 同口径但只过滤不阻断，保留旧 draft 的部分可用） |
| `agent-drafts/[id]/publish/route.ts` POST | 已规划：provider + KB 两路 canReadRow | 不变 |

**duplicate 的设计取舍**：硬阻断 vs 软降级。倾向**软降级**（剥离不可见 ids 但允许复制），因为复制是"拿别人的模板改造"的高频操作，硬阻断会把"复制平台公共的 demo agent"这种正常路径误伤。

### §3 · embedding provider 强制平台公共（基建例外）

小B 指出 [`embed.ts:22-31`](../../lib/kb/embed.ts) 全局取第一个 enabled embedding provider，零归属判断。如果 org_admin 能建自己的 embedding provider，会造成：

- orgA 建库时全局拿到 orgB 的 embedding key（虽然 enabled 排序拿到的不一定是 orgB 的，但**有概率发生**）
- 文档片段送到 orgB provider 做向量化 = orgA 资料发送到 orgB 的上游 API key
- orgB 看到自己 key 的调用账单里有不明流量

**决策**：embedding 是基础设施，**强制只能 super/system 建**（`tenant_code` 强制 NULL），org_admin 创建 embedding category provider → 422。

**为什么不是"按 KB 绑定 embedding provider_id"**：

- 改动面大（kb_chunks 检索时要按 KB 的 embedding 算余弦距离 / 模型不一致就无法跨 KB 检索）
- 当前 KB 检索 RPC `match_kb_chunks` 假设全平台同维度（1024 维）—— 若允许 org 自建 embedding 维度不同则不可用
- 5.30up 只解决 RBAC，不动 RAG 基建口径

**实施位置**：

- `model-providers/route.ts` POST 中 `resolveCreateOwnership` 之后加判：`if (category === "embedding" && admin.role === "org_admin") return apiError("Embedding 配置为平台基础设施，组织管理员无法创建", "FORBIDDEN")`
- 类似的，`model-providers/[id]/route.ts` PATCH 时若试图把 embedding provider 的 `tenant_code` 改成非 NULL → 拒（仅 super_admin 能改 embedding，且只能改回 NULL）

**前端**：org_admin 看到的 API 管理页 embedding tab 不显示"新增"按钮（embedding 一栏一定是平台公共，组织管理员只读）。

### §4 · KB 详情引用列表 org_admin 屏蔽 agent 名

小B 指出 [`knowledge-bases/[id]/route.ts:44-61`](../../app/api/admin/knowledge-bases/[id]/route.ts) 反查 `agent_knowledge_bases` + `agents.name` 时零过滤——org_admin 看到一个平台公共 KB，引用列表里会出现别 org 的 agent name，构成 **agent 名跨组织泄漏**。

**决策**：

- super / system → 返回完整 `referencedByAgents: { id, name }[]`（不变）
- org_admin → 返回 `referencedByAgentCount: number`，**不返 agent name 列表**
- 计数本身不算泄漏（仅一个数，无法逆推具体 agent），但 UI 上文案改成"被 N 个智能体引用（含本组织外）"，避免误导 admin 以为全部能管

**响应 schema 变化**：

```diff
GET /api/admin/knowledge-bases/:id

  super/system:
+   referencedByAgents: [{ id, name }, ...]   // 旧字段

  org_admin:
+   referencedByAgents: undefined              // 不返
+   referencedByAgentCount: number             // 新字段
```

前端 KB 详情页对应渲染做角色分支。

### §5 · audit.ts 补 model_provider / knowledge_base 归属

[`audit.ts:5-14`](../../lib/audit.ts) 的 `AuditResourceType` 没有 `knowledge_base`，且 [`audit.ts:30-79`](../../lib/audit.ts) `resolveResourceTenantCode` 没有 `model_provider` / `knowledge_base` 两个 case，默认 fallthrough 到 `default: return null`。

不补的话：

- org_admin 管自己 org 的 provider / KB，写审计时 `resource_tenant_code` 字段为 NULL
- 组织管理员看自己组织的审计记录时 **拉不到自己的操作**（按 resource_tenant_code 过滤的列表会漏）
- 平台审计也无法按 tenant 切片

**改动**（Phase 0 必做，A/B 半都依赖）：

```ts
// lib/audit.ts

export type AuditResourceType =
  | "agent" | "workflow" | "workflow_step"
  | ...
  | "model_provider"
  | "agent_draft"
  | "knowledge_base";              // ✚ 新增

// resolveResourceTenantCode 加两个 case：
case "model_provider": {
  const { data } = await db.from("model_providers")
    .select("tenant_code").eq("id", resourceId).maybeSingle();
  return data?.tenant_code ?? null;
}
case "knowledge_base": {
  const { data } = await db.from("knowledge_bases")
    .select("tenant_code").eq("id", resourceId).maybeSingle();
  return data?.tenant_code ?? null;
}
```

KB 各路由的 `writeAuditLog` 调用相应改 `resourceType: "knowledge_base"`。**DELETE 路径**注意：必须在 DELETE 前 await `resolveResourceTenantCode` 缓存（同 audit.ts 的现有警告），否则删完查不到。

### §6 · ownership 转让的引用扫描（含 draft JSON）

小B 指出 super/system 改 `tenant_code` 时，方案只想到 published agents 引用，没扫 draft 里 JSON 数组 + agent_knowledge_bases 表。**改 ownership = 隐性破坏跨 org 引用**，必须先扫净。

**扫描矩阵**：

| 资源 | 引用面 | 扫描方式 |
|---|---|---|
| provider 转让 / 删除 | `agents.provider_id = :id` | `eq("provider_id", id).count` |
| provider 转让 / 删除 | `agent_drafts.provider_id = :id` | 同上 |
| KB 转让 / 删除 | `agent_knowledge_bases.kb_id = :id` | `eq("kb_id", id).count` |
| KB 转让 / 删除 | `agent_drafts.builder_config.knowledge_base_ids @> [:id]` | Supabase: `.contains("builder_config", { knowledge_base_ids: [id] })` |

**转让动作的判定规则（R2 已覆盖，本段只保留引用扫描面）**：

- R1 旧设想曾考虑"引用方归属与新 tenant 一致则允许转让"
- 该判断被 R2 §4 废弃：`agent_drafts` 无 tenant_code，正式 agent 又经 `resource_permissions` 间接表达可见范围，边界复杂
- **最终实施唯一口径：转让 `tenant_code` 必须零引用**。无论转给某 org 还是转回 NULL，只要 `scanReferences(resource, id).totalCount > 0` 就阻断
- DELETE 与 PATCH 转让共用同一个 `scanReferences` helper，避免两套引用扫描口径漂移

**实施位置**：

- `model-providers/[id]/route.ts` PATCH：检测到 `patch.tenant_code` 变更（仅 super/system 走到这）时，先扫两表
- `knowledge-bases/[id]/route.ts` PATCH：同理，但要扫 `agent_knowledge_bases` + `agent_drafts.builder_config.knowledge_base_ids` JSON

**DELETE 已有引用检查**（[model-providers/[id]/route.ts:195-226](../../app/api/admin/model-providers/[id]/route.ts)），保留并扩展给 KB（KB DELETE 已扫 `agent_knowledge_bases`，但**没扫 draft JSON 引用**——补上）。

### §7 · 侧边栏导航：解开 SS_ROLES

[`admin-layout.tsx:57`](../../components/layout/admin-layout.tsx) `API 管理` 和 L59 `知识库管理` 都用 `SS_ROLES`，org_admin 进后台根本看不到菜单。

**改动**：

```tsx
// admin-layout.tsx

const SS_ROLES: AdminRole[] = ["super_admin", "system_admin"];
+ const RBAC_SCOPED_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"]; // 5.30up

  // 内容组
- { href: "/admin/model-providers", label: "API 管理",   ... allowedRoles: SS_ROLES },
+ { href: "/admin/model-providers", label: "API 管理",   ... allowedRoles: RBAC_SCOPED_ROLES },
- { href: "/admin/knowledge-bases", label: "知识库管理", ... allowedRoles: SS_ROLES },
+ { href: "/admin/knowledge-bases", label: "知识库管理", ... allowedRoles: RBAC_SCOPED_ROLES },
```

注：不复用 `ALL_ROLES`，新建 `RBAC_SCOPED_ROLES`——语义上区分"全员可见"和"按 ownership 看子集"，**未来若加新资源走相同口径**只动一个常量名引用列表。

---

## R2 收口 · 小B 二审 6 + 2 项

R1 把"漏掉的资源边界"补齐后，R2 修的是"实现细节如果照 R1 写还是会出权限洞"。

### §1 · 双闸模型：角色白名单 + canWriteRow 是两道独立闸

`canWriteRow` 通用语义就是"判归属"（super/system → true；org_admin → 比 tenantCode），**不判角色白名单**。 角色白名单是"资源级业务口径"，由路由层显式做。两道闸都过才算可写。

**API 管理路由白名单**（**显式排除 system_admin**）：

| 路由方法 | 写白名单（必须先过） | 归属判定（canWriteRow 走它）|
|---|---|---|
| `model-providers/route.ts` POST | `["super_admin", "org_admin"]` | resolveCreateOwnership |
| `model-providers/[id]/route.ts` PATCH | `["super_admin", "org_admin"]` | canWriteRow |
| `model-providers/[id]/route.ts` DELETE | `["super_admin", "org_admin"]` | canWriteRow |
| `model-providers/[id]/test/route.ts` POST | `["super_admin", "system_admin", "org_admin"]` ⚠️ 测试不算"写" | canWriteRow（org_admin 仍只测 own）|

**KB 路由白名单**（system_admin 沿用现状）：

| 路由方法 | 写白名单 | 归属判定 |
|---|---|---|
| 所有 KB 写 + 文档写路由 | `["super_admin", "system_admin", "org_admin"]` | canWriteRow |

**实施模板**（每个写路由顶上统一调用 `requireWriteAccess`，避免漏写白名单 / tenantCode 兜底）：

```ts
// 1. requireAdmin（已有）
const admin = await requireAdmin();
if (admin instanceof Response) return admin;

// 2. R2 §1 / §2 / §6 · 资源级角色白名单 + org_admin tenantCode 非空/存在性兜底
const accessError = await requireWriteAccess(admin, WRITE_ROLES_FOR_THIS_RESOURCE);
if (accessError) return accessError;

// 3. 加载 row → canWriteRow / resolveCreateOwnership（已有的归属判断）
```

`requireWriteAccess` 只做"当前管理员是否允许进入这个写接口"：角色白名单、org_admin `tenantCode` 非空、org_admin `tenantCode` 在 `tenants` 表存在。它**不**替代 `canWriteRow`，避免"能进接口"和"能写这条资源"混成一件事。

### §2 · org_admin 缺 tenantCode 全部 fail-closed

已在上方"口径细则"全部改 ✓。**核心：5 个 helper + 路由层第 3 步**——任何一道闸都能堵。

### §3 · embedding super/system POST 也强制 tenant_code = NULL

R1 只想到 org_admin 创建 embedding 拒、PATCH 不准改成非 NULL。**漏掉 super/system POST 时也可能塞 `tenant_code`**——R2 补：

`model-providers/route.ts` POST：调 `resolveCreateOwnership` 前先做：

```ts
if (payload.category === "embedding"
    && payload.tenant_code !== null && payload.tenant_code !== undefined
    && String(payload.tenant_code).trim() !== "") {
  return apiError(
    "Embedding 配置为平台基础设施，必须归属平台公共（tenant_code 必须为空）",
    "VALIDATION_ERROR",
  );
}
```

同理 PATCH：若 `category === "embedding"` + patch 含 `tenant_code` 非空 → 422。

### §4 · ownership 转让简化为"零引用模式"

小B 指出 [`agent_drafts` 表无 tenant_code](../../supabase/migration_v36_agent_drafts.sql)（只有 `created_by`），agent 的归属经 `resource_permissions` 表的 all / org / owner_only 三态间接表达（见 [publish/route.ts:317-323](../../app/api/admin/agent-drafts/[id]/publish/route.ts)）。**"引用方归属与新 tenant 一致" 无简洁算法可写**。

R2 决策：**转让 `tenant_code` 与 DELETE 走同一口径——必须零引用**。

| 操作 | 旧 R1 口径 | R2 新口径 |
|---|---|---|
| 转让 provider tenant_code | 扫引用 + 判"引用方归属是否与新 tenant 一致" | **扫零引用**（同 DELETE）|
| 转让 KB tenant_code | 同上 | **扫零引用**（同 DELETE）|

**算法极简**（路由层在 `sanitizeUpdatePatch` 后、写 DB 前）：

```ts
// 仅 super/system 能走到这（org_admin 的 tenant_code 已被 sanitize 剥离）
if ("tenant_code" in patch && patch.tenant_code !== existing.tenant_code) {
  // 扫所有引用面（同 DELETE 检查）
  const refs = await scanReferences(resource, existingId);
  if (refs.totalCount > 0) {
    return apiError(
      `资源被 ${refs.totalCount} 处引用，转让前请先解绑（${refs.byPlace.join(" / ")}）`,
      "VALIDATION_ERROR",
    );
  }
}
```

**取舍：**

- super_admin 体验稍差（要先解绑才能转让），但**转让是低频操作**，体验代价可接受
- 消除"引用方归属"的复杂判断 = 消除 N 个边界 bug 的可能性
- 与现有 DELETE 引用阻断逻辑完全对称（[model-providers/[id]/route.ts:195-226](../../app/api/admin/model-providers/[id]/route.ts)），代码可抽公共 helper `scanReferences(resource, id)` 让 PATCH/DELETE 共用

### §5 · KB 路由本身补 writeAuditLog（不止 audit.ts）

小B 指出 KB 路由现在**完全没有审计写入**：

- [`knowledge-bases/route.ts:58-97`](../../app/api/admin/knowledge-bases/route.ts) POST 无 `writeAuditLog`
- [`knowledge-bases/[id]/route.ts:71-114`](../../app/api/admin/knowledge-bases/[id]/route.ts) PATCH 无
- [`knowledge-bases/[id]/route.ts:118-171`](../../app/api/admin/knowledge-bases/[id]/route.ts) DELETE 无
- 文档上传 / 删除 / 重建索引 路由同样无

R2 在 Phase B 补完：

| 路由 | 加什么审计 |
|---|---|
| KB POST | `action: "create", resource_type: "knowledge_base"` |
| KB PATCH | `action: "update"`（带 fields 列表）|
| KB DELETE | `action: "delete"`（DELETE 前 await `resolveResourceTenantCode` 缓存 tenant_code）|
| 文档 POST 上传 | `action: "create", resource_type: "knowledge_base", detail: { document_id, filename }`（资源仍记 KB 而非文档，简化粒度）|
| 文档 DELETE | `action: "delete", detail: { document_id }` |
| 文档重建索引 | `action: "update", detail: { document_id, reindex: true }` |

**注**：R1 §5 改 `audit.ts` 是基础设施，R2 §5 是把基础设施真的用起来。两件事都做。

### §6 · 写入 tenant_code 必须校验 tenants 存在

小B 完全正确——既然允许资源归属到某 org，就必须查存在性，否则一个拼错的 code 或已删除的 org code 会制造孤儿。

R2 新增 helper `validateTenantCode(code: string): Promise<boolean>`（已加入"口径细则"）。**调用位置**：

- API + KB POST：payload 含 `tenant_code` 非空 → 路由层调一次
- API + KB PATCH：patch 含 `tenant_code` 非空 → 路由层调一次（在 `sanitizeUpdatePatch` 与转让零引用检查之间）
- org_admin POST：`resolveCreateOwnership` 强制得到 `admin.tenantCode` 后，也调 `validateTenantCode(admin.tenantCode)`；不存在 → 403，不创建资源
- org_admin PATCH / DELETE / 文档写：路由层第 3 步检查 `admin.tenantCode` 非空后，再调 `validateTenantCode(admin.tenantCode)`；不存在 → 403

**注**：该 helper 留在 scoped-access.ts 内导出，与 5 个核心函数同文件管理，但因为它是 async + 触 DB，单独拆出避免拖累核心函数的纯逻辑可测性。

### 小问题 1 · 单测 25 + 2 = 27 ✓

已在"口径细则"修正（R1 写 20 是笔误）。

### 小问题 2 · 上线步骤补 MIGRATIONS.md 同步

加迁移文件后**必须同步更新** [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md)（项目已有规约，R1 漏写）。已在下方"上线步骤"补上。

---

### Phase 0 · 共用基建（**必须先做，串行**）

| 改动 | 文件 |
|---|---|
| 新增迁移：两表加 `tenant_code` + 单列索引 | `supabase/migration_v43_scoped_ownership.sql`（新建）|
| **R2 · 同步更新迁移索引** | [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md) 加 v43 条目（项目规约）|
| 共用工具（5 核心函数 + `requireWriteAccess` + `validateTenantCode` async + `scanReferences`）| `lib/scoped-access.ts`（新建）|
| **R1 §5 · audit.ts 补全** | [`lib/audit.ts`](../../lib/audit.ts) 加 `knowledge_base` 资源类型 + `model_provider` / `knowledge_base` 两个 `resolveResourceTenantCode` 分支 |
| 单测 | `tests/scoped-access.test.ts`（5×5=25）+ `tests/validate-tenant-code.test.ts`（2）+ `tests/write-access.test.ts`（6）+ `tests/audit-resolve-tenant.test.ts`（6）= **共 39 用例**（R2 修正）|

迁移 SQL 草稿（**审核后再跑**）：

```sql
-- 5.30up · model_providers + knowledge_bases 加 tenant_code 实现组织级 ownership
-- 幂等：IF NOT EXISTS / IF EXISTS
ALTER TABLE model_providers   ADD COLUMN IF NOT EXISTS tenant_code TEXT NULL;
ALTER TABLE knowledge_bases   ADD COLUMN IF NOT EXISTS tenant_code TEXT NULL;
CREATE INDEX IF NOT EXISTS model_providers_tenant_code_idx ON model_providers(tenant_code);
CREATE INDEX IF NOT EXISTS knowledge_bases_tenant_code_idx ON knowledge_bases(tenant_code);
-- 存量数据保持 NULL（平台公共），无需 UPDATE
NOTIFY pgrst, 'reload schema';
```

### Phase A · API 管理（小A 实施）

**API 管理路由（6 条）**：

> **写白名单（R2 §1 双闸）**：POST/PATCH/DELETE 为 `["super_admin", "org_admin"]`（**显式排 system_admin**）；test 为 `["super_admin", "system_admin", "org_admin"]`。所有写路由还要做 R2 §2 的 `org_admin + 缺 tenantCode → 403` 兜底。

| 路由 | 改动 |
|---|---|
| `model-providers/route.ts` GET | 接 `applyListScope`；不再"全员都返"|
| `model-providers/route.ts` POST | **R2 §1 · 白名单**；接 `resolveCreateOwnership` 注入 tenant_code；**R1 §3 + R2 §3 · embedding 强制平台公共**（org_admin 创建 → 422；super/system 显式带 `tenant_code` → 422）；**R2 §6 · 显式 `tenant_code` 调 `validateTenantCode`** |
| `model-providers/[id]/route.ts` GET | 接 `applyListScope` 或先读后 `canReadRow`；404 屏蔽 |
| `model-providers/[id]/route.ts` PATCH | **R2 §1 · 白名单**；先读判 `canWriteRow`；patch 走 `sanitizeUpdatePatch`；**R1 §3 + R2 §3 · embedding tenant_code 不准改成非 NULL**；**R2 §6 · 显式 `tenant_code` 调 `validateTenantCode`**；**R2 §4 · 转让 tenant_code 走零引用阻断**（scan agents + drafts）|
| `model-providers/[id]/route.ts` DELETE | **R2 §1 · 白名单**；先读判 `canWriteRow`（已有 agents + drafts 引用检查，保留，与 R2 §4 共用 `scanReferences` helper）|
| `model-providers/[id]/test/route.ts` POST | **R2 §1 · test 白名单含 system_admin**；先读判 `canWriteRow`（org_admin 仅 own 可测；super/system 任意）|

**R1 §2 · 草稿 / 测试聊天链路收口（4 条）**：

| 路由 | 改动 |
|---|---|
| `agent-drafts/route.ts` POST | 入参 `provider_id` 和 `builder_config.knowledge_base_ids[]` 全部 `canReadRow`，不可见的 ids → 422 + 列出 |
| `agent-drafts/[id]/route.ts` PATCH | 同上 |
| `agent-drafts/[id]/duplicate/route.ts` POST | **软降级口径**：复制时按当前 admin 视角重新校验，不可见的 provider 设 NULL / 不可见 KB 从 array 移除；响应里返回 `strippedIds: { provider, kbs }` 让前端 toast 提示 |
| `agent-drafts/[id]/test-chat/route.ts` POST | provider `canReadRow` 失败 → 403；KB ids 用 `canReadRow` 过滤后再传给检索（不阻断对话，仅过滤不可见 KB）|
| `agent-drafts/[id]/publish/route.ts` POST | （原 R0）加载 provider 后 `canReadRow`；加载 KB ids 后逐个 `canReadRow`；任一失败 → 403 |

**前端：**

| 页面 / 组件 | 改动 |
|---|---|
| `app/admin/model-providers/page.tsx` 列表 | 每行加"归属"徽章（平台 / 本组织 / 其他组织）；编辑/删除/测试按钮按 ownership 灰显；**R1 §3 · embedding tab 对 org_admin 隐藏"新增"按钮** |
| 新建 / 编辑弹窗 | super/system 加"归属组织"下拉（可选）；org_admin 隐藏，强制本组织 |
| **R1 §7 · `components/layout/admin-layout.tsx`** | 新增 `RBAC_SCOPED_ROLES`；`API 管理` / `知识库管理` 两条菜单从 `SS_ROLES` 改为 `RBAC_SCOPED_ROLES` |
| `app/admin/agent-builder/[id]/page.tsx` provider 下拉 | 后端 list 已带过滤，前端不需改；duplicate 后若有 strippedIds 显示 toast 提示 |

### Phase B · 知识库（与 A 半并行）

**KB 管理路由（5 + 2）**：

| 路由 | 改动 |
|---|---|
| `knowledge-bases/route.ts` GET | 删 `denyKbAdmin`；接 `applyListScope` |
| `knowledge-bases/route.ts` POST | 删 `denyKbAdmin`；接 `resolveCreateOwnership`；**R2 §6 · 显式 `tenant_code` 调 `validateTenantCode`**；**R2 §5 · 加 `writeAuditLog(create)`** |
| `knowledge-bases/[id]/route.ts` GET | 删 `denyKbAdmin`；先读判 `canReadRow`；404 屏蔽；**R1 §4 · org_admin 不返 `referencedByAgents` 列表，只返 `referencedByAgentCount`** |
| `knowledge-bases/[id]/route.ts` PATCH | 同上 + `canWriteRow` + `sanitizeUpdatePatch`；**R2 §6 · 显式 `tenant_code` 调 `validateTenantCode`**；**R2 §4 · 转让 tenant_code 走零引用阻断**；**R2 §5 · 加 `writeAuditLog(update)`** |
| `knowledge-bases/[id]/route.ts` DELETE | 同上 + `canWriteRow`；现有 agent_knowledge_bases 引用检查保留；**R2 §4 · 加 draft JSON 引用扫描**；**R2 §5 · 加 `writeAuditLog(delete)`**（DELETE 前 await `resolveResourceTenantCode` 缓存）|
| `knowledge-bases/[id]/documents/route.ts` GET / POST | 先 load 父 KB，`canReadRow` / `canWriteRow`；**R2 §5 · POST 上传加 `writeAuditLog(create)`** |
| `knowledge-bases/[id]/documents/[docId]/route.ts` DELETE / 重建索引 | 同上；**R2 §5 · DELETE 加 `writeAuditLog(delete)`、reindex 加 `writeAuditLog(update)`** |

**注**：草稿 / 测试聊天 / 发布的 KB 校验在 Phase A 的"R1 §2 草稿链路"已 cover（一处实现，A/B 共用），B 半不需重复。

**前端：**

| 页面 | 改动 |
|---|---|
| 知识库管理页 | 列表归属徽章 + 操作按钮按 ownership 灰显 |
| 新建 / 编辑 | 同 API 管理弹窗口径 |
| `agent-builder` 的 KB 多选 | 后端 list 已过滤，前端不需改；publish 校验补 |

**发布路由 publish：**

已合入上方"R1 §2 草稿链路收口"四条路由表，**不再单独列**。publish 现 cover provider + KB 双校验，A/B 共享同一改动。

**节奏：KB 主功能已稳**。RAG 方案 A/B 在 5.19up / 5.20up / 5.21up 已上线，5.28up 完成异步化 + chunk 进度 + 引用可视化 + 小B 第二轮收口，KB 表结构与路由层已多轮验收过。B 半可与 A 半完全并行，无 schema migration 撞车风险。

### Phase Z · 联合验收

- 跨 org 渗透用例（见下文「验收口径」）
- 审计日志检查：是否每个写操作都正确落库、admin tenantCode 字段是否被记录
- 文档：5.30up 变更记录

---

## 并行开发的细节

### 串行段：Phase 0 必须先做

理由：A / B 半都依赖 `lib/scoped-access.ts` 和 schema 字段。`lib/scoped-access.ts` 写完 + 单测过 + DB 迁移跑完，A 半 B 半才能并行。

### A 半 / B 半的接缝

- 不共用业务路由文件，独立目录 → 不会撞 Edit
- 唯一可能撞的：`publish/route.ts` —— 两半各加一道校验（provider / kb），加得彼此独立，注意 Edit 时 anchor 别撞同一段
- **变更记录文件分开写**：`5.30up/变更记录-A半-20260YYxx.md` / `变更记录-B半-20260YYxx.md`，最终合并到 `5.30up/变更记录.md` 总入口

### Phase 安排示意

```
[Phase 0 · 串行]                Day 1
  ├─ DB 迁移
  ├─ lib/scoped-access.ts
  └─ 单测

[Phase A · API 管理]   [Phase B · 知识库]    Day 2-4 并行
  ├─ API 路由 6 处         ├─ KB 路由 7 处
  ├─ 草稿链路 5 处         ├─ KB 详情 org_admin 屏蔽 agent 名
  ├─ 模型接入页 UI         ├─ 知识库管理页 UI
  ├─ admin-layout 导航     ├─ super/system tenant 转让扫 draft JSON
  └─ embedding 例外约束    └─ （草稿链路在 A 半实现，共享）

[Phase Z · 联合验收]            Day 5
  └─ 渗透 + 审计 + changelog
```

---

## 验收口径（每个写接口都必须过）

### A 半 / B 半通用渗透用例（10 条）

伪造身份测试（用 orgA / orgB / super 三套 token 跑）：

1. ✅ orgA admin 可 list 到"平台公共"资源
2. ❌ orgA admin **不能** list 到 orgB 资源（响应里完全不出现 orgB 的 id）
3. ❌ orgA admin **不能** GET orgB 资源详情（返 404，不是 403）
4. ❌ orgA admin **不能** PATCH orgB 资源（即使知道 id；返 404）
5. ❌ orgA admin **不能** DELETE orgB 资源（404）
6. ❌ orgA admin **不能** test orgB API provider（404；仅 A 半）
7. ⚠️ orgA admin POST 时即使 payload 塞 `tenant_code: "ORG-B"` → 后端**强制改为** orgA，并照常创建
8. ⚠️ orgA admin PATCH 自己资源时即使 payload 塞 `tenant_code: "ORG-B"` → 后端**剥离**该字段，其它字段照常更新
9. ✅ orgA admin **可** GET / 使用平台公共资源；❌ 但**不能** PATCH / DELETE 平台公共资源（403）
10. ❌ orgA admin 的 draft 引用 orgB 的 provider_id / kb_id → publish 拒绝（VALIDATION_ERROR 或 FORBIDDEN）

### A 半专有用例

11. orgA 的 provider_code 想叫 `openai-main`，全局已被 super 占用 → 友好错误"已存在"
12. agent-builder 模型下拉里 org_admin 只看到平台公共 + 本组织的 provider
13. orgA admin 试图创建 category=embedding 的 provider → 422 + "Embedding 配置为平台基础设施…"
14. super admin 改 platform provider 的 tenant_code 改成 orgB，但该 provider 被 orgC 的 draft 引用 → 阻断 + 列出引用 draft
15. org_admin 在「API 管理」页看到的 embedding tab 不显示"新增"按钮

### B 半专有用例

16. orgA 的 KB 上传文档 → 文档操作只能在该 KB 范围内（已有的 finding 3 `docId ↔ kbId` 校验仍要走）
17. orgA 上传文档到 orgB KB → 404（KB 不可见，整条路径不存在）
18. agent-builder 知识库多选里 org_admin 只看到平台公共 + 本组织的 KB
19. orgA admin 看一个平台公共 KB 详情 → 返回 `referencedByAgentCount: N`，**不返 `referencedByAgents` 数组**
20. super 改 KB tenant_code 时扫到某 orgC draft 的 `builder_config.knowledge_base_ids` 引用该 KB → 阻断

### 草稿 / 测试聊天链路专有用例（R1 §2 收口）

21. orgA admin POST `/agent-drafts` 时塞别 org 的 `provider_id` → 422 + 明确报错
22. orgA admin PATCH draft 时塞别 org 的 `builder_config.knowledge_base_ids[]` 含别 org KB → 422
23. orgA admin POST `/agent-drafts/:id/test-chat` 时 draft 的 provider_id 指向别 org → 403
24. orgA admin POST `/agent-drafts/:id/test-chat` 时 draft 的 kb_ids 含别 org KB → 别 org KB 被静默过滤掉，**不阻断对话**（与 publish 不同；publish 是阻断 / test-chat 是过滤）
25. orgA admin POST `/agent-drafts/:id/duplicate` 复制 super 建的 demo draft（含平台公共 provider + 含别 org KB）→ 平台公共 provider 保留，别 org KB 被剥离，返回 `strippedIds.kbs: [...]`

### 审计日志专有用例（R1 §5）

26. orgA admin 创建 / 改 / 删自己的 provider → 审计 `resource_tenant_code` = orgA（不是 null）
27. orgA admin 看自己组织的审计列表能拉到上述操作（按 resource_tenant_code 过滤生效）
28. orgA admin 创建 KB 文档 → 审计 `resource_type: knowledge_base`（不是 default null）

### R2 双闸 / ownership 兜底专有用例

29. system_admin 调 API 管理 POST / PATCH / DELETE → 403；但 GET / test provider 仍可用
30. org_admin token 有角色但 `tenantCode = null` → API / KB list 不返平台公共资源；所有详情 / 写 / test / 文档操作 fail-closed（403 或 404，按接口屏蔽策略）
31. super/system POST 或 PATCH API / KB 时显式传不存在的 `tenant_code` → 422 + "组织不存在"
32. org_admin 的 `admin.tenantCode` 指向已删除 / 不存在的 `tenants.code` → POST / PATCH / DELETE / 文档写均 403，不创建孤儿资源
33. super/system 创建或编辑 `category=embedding` provider 时带非空 `tenant_code` → 422，embedding 永远平台公共
34. super/system 把有任意引用的 provider / KB 的 `tenant_code` 改为某 org 或 NULL → 422，提示先解绑（零引用模式）
35. `scanReferences("provider" | "kb", id)` 同时覆盖 provider 的 `agents + agent_drafts`、KB 的 `agent_knowledge_bases + agent_drafts.builder_config.knowledge_base_ids` 四类引用面

---

## 主要风险

### 🔴 R1 · 漏一个写接口 = 越权 / 数据泄露

任何一个写接口忘记调 `canWriteRow` 就是 orgA 改 orgB 数据。

**缓解：**

- 所有写接口必须 `import { canWriteRow }`，code review 时强制检查
- 单测覆盖每个 endpoint 的 cross-org 反例
- 渗透 10 条用例为必跑项

### ~~🟡 R2 · KB 还在 devC 主功能开发中~~ → 已消解

原顾虑撤回：KB 主功能（RAG 方案 A / B）在 5.19up–5.21up 已上线，5.28up 完成异步化 + chunk 进度 + 引用可视化 + 小B 二轮收口。`knowledge_bases` 表结构与路由层多轮验收过，B 半权限层叠上去无撞车风险，可与 A 半完全并行。

### 🟡 R3 · 历史 agent_drafts / agents 怎么办

现有 draft / agent 引用的 provider 都是平台公共（NULL），新规则下任何 admin 都可访问，**不会出现兼容问题**。

但如果 super_admin 将来把某 provider 的 ownership 改成某 org → 引用该 provider 的别 org draft / agent 会出问题。

**缓解（已在 R1 §6 落实）：**

- super/system PATCH 改 `tenant_code` 时做**引用检查**：扫 `agents.provider_id` / `agent_drafts.provider_id` / `agent_knowledge_bases.kb_id` / `agent_drafts.builder_config.knowledge_base_ids` JSON 四张引用面
- 若有别 org 的 agent / draft 引用 → 阻断 + 提示"请先解除引用"
- 同 `model-providers DELETE` 现有的"被 N 个智能体引用"模式

### 🟢 R4 · provider_code 全局 UNIQUE 在多 org 场景的命名冲突

org 想用与 super/system 已有的 provider_code 相同的命名（如都想叫 `openai-main`）→ 撞。

**缓解：**

- 文档提示 org 命名前缀加组织码
- 友好错误（已有逻辑）
- 不动 UNIQUE 约束

### 🟢 R5 · tenant 解散

如果某 org 被删，他们的资源 `tenant_code` 仍指向不存在的 org code。

**缓解：**

- 没加 FK，不会自动失联
- 资源变成"孤儿"，super_admin 列表可见、可处置（删 / 转让）
- 后续可加管理脚本扫描孤儿

### 🟡 R6 · embedding 平台公共专用是不是太死

R1 §3 的决策让 org_admin 不能建 embedding provider。如果将来：

- 某 org 想用与平台不同的 embedding 模型（自己的 dimension 维度 / 自己的供应商）
- 某 org 担心文档向量化时数据走平台 embedding key 不合规

→ 5.30up 解不了，必须演进。

**缓解：**

- 当前 1 个 embedding provider 平台共用是现状（[`embed.ts:22-31`](../../lib/kb/embed.ts) 现就这么写），5.30up 没让现状更糟
- 真要按 KB 绑 embedding，要重做 `match_kb_chunks` RPC（kb_chunks.embedding 当前 `vector(1024)` 固定维度），是 RAG 主功能演进，不在本期
- 现在的口径**留余地**：建库时已经记录 `embedding_model` 字段（`migration_v38` 行 23），未来按 KB 绑 provider 也能取到

---

## 不在本期范围

- KB / API 在 org 之间的转让流程（手动改 tenant_code 走 super_admin）
- 跨 org 协作 / 共享（如让 orgA 把 KB 临时给 orgB 用）
- org 内子角色（团队 / 部门级权限）
- API key 配额 / 限流
- 5.16up ENCRYPTION_KEY 拆分相关（已隔离）

---

## 上线步骤（待全部并行做完后）

1. **跑 `migration_v43_scoped_ownership.sql`**（dev DB 先；线上 DB 5/19 大合并已上线，可独立跑这条小迁移）
2. **同步更新 [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md)**（R2 §小问题 2 · 项目规约：加迁移必更新索引）
3. 部署 A 半 + B 半代码（一起部署，避免一边新口径一边旧口径）
4. 验收：
   - 用 orgA / orgB / super 三套账号分别登录
   - 跑 35 条渗透用例（R1/R2 后扩展，含草稿链路、审计、双闸、tenant_code 存在性与零引用转让）
   - 看审计日志：org_admin 操作 provider 和 KB 时 `resource_tenant_code` 字段是否正确落库
   - org_admin 看自己组织的审计列表能否拉到这些操作
5. 通知 admin：org_admin 现在能管 API + KB；仅限本组织新增的

---

## 待小B 三评（R2 改后）

### 你 R1 提的 6 + 2 点，现在分别在哪

| 你的编号 | 处理位置 | 摘要 |
|---|---|---|
| §1 API 写权限与 canWriteRow 冲突 | R2 §1 + Phase A 路由表 | **双闸模型**：每个写路由路由层先做角色白名单（API 写明确排 system_admin），再走 canWriteRow 判归属 |
| §2 org_admin 缺 tenantCode 不严 | R2 §2 + helper 口径细则 | 5 个 helper 全部 fail-closed；路由层第 3 步兜底拦 |
| §3 embedding POST 细节漏 super/system | R2 §3 + Phase A POST/PATCH | super/system 显式带 `tenant_code` → 422 |
| §4 转让算法卡在"引用方归属" | R2 §4 + Phase A/B PATCH | **简化为零引用阻断**（与 DELETE 同口径，共用 `scanReferences`）|
| §5 KB 路由本身无 writeAuditLog | R2 §5 + Phase B 路由表 | 5 个 KB 写路径全部加 `writeAuditLog`，记 `knowledge_base` 资源类型 |
| §6 tenants.code 存在性校验 | R2 §6 + 新增 helper | `validateTenantCode` async helper，POST/PATCH 显式带 tenant_code 时路由层先调 |
| 小1 单测数 25 笔误 | helper 口径细则 | 改为 25（核心）+ 2（validate）= 27，加 audit 6 = 33 总 |
| 小2 MIGRATIONS.md | 上线步骤 #2 | 跑迁移后强制同步索引 |

### 你 R0 提的 7 点（R1 已收口，未变更）

| 你的编号 | 处理位置 | 摘要 |
|---|---|---|
| §1 system_admin 放权 | 权限矩阵 / API 表 | API 写仍归 super；KB 沿用现状全写 |
| §2 草稿链路漏 | R1 §2 + Phase A 草稿 5 条路由 | POST/PATCH 422 阻断、duplicate 软降级、test-chat 阻断 provider + 过滤 KB、publish 阻断 |
| §3 embedding 归属 | R1 §3 + R2 §3 + Phase A POST/PATCH | embedding 强制平台公共，三种身份都拦 |
| §4 KB 引用泄漏 agent 名 | R1 §4 + Phase B KB detail 路由 | org_admin 只返计数不返列表 |
| §5 audit.ts 缺归属 | R1 §5 + Phase 0 | 加 `knowledge_base` 类型 + 两个 resolveResourceTenantCode 分支 |
| §6 转让引用扫描不全 | R1 §6（已被 R2 §4 进一步简化） | 改成零引用模式 |
| §7 侧边栏入口漏 | R1 §7 + Phase A 前端 | 新增 RBAC_SCOPED_ROLES 常量 |

### 开工前实施决策（不再阻塞）

1. **duplicate 软降级**：复制时剥离不可见 provider / KB，响应返回 `strippedIds`，前端 toast 提示；不硬阻断复制 demo agent。
2. **embedding 强制平台公共**：5.30up 不做按 KB 绑定 embedding provider；这是后续 RAG 演进议题，本期只堵 org ownership 泄漏。
3. **KB 详情 org_admin 只返引用计数**：不返回 `referencedByAgents` 名单；文案用"被 N 个智能体引用（含本组织外）"。
4. **draft JSON 扫描可无 GIN 索引**：`agent_drafts.builder_config.knowledge_base_ids` 用 `.contains()` / `@>` 扫描；转让低频，先不加 GIN。
5. **抽 `scanReferences` 公共 helper**：PATCH 转让 + DELETE 共用同一扫描函数，签名 `scanReferences(resource: "provider" | "kb", id: string): Promise<{ totalCount, byPlace }>`。
6. **抽 `requireWriteAccess` 小 helper**：统一 requireAdmin 后的角色白名单 + org_admin tenantCode 非空 / 存在性兜底；路由层仍显式传 allowList，避免 API 与 KB 写权限混淆。

### 原 R0 的 8 点核心方向（仍生效，未变更）

1. **`tenant_code TEXT NULL`** 设计 + 不加 FK + 不启 RLS
2. **`lib/scoped-access.ts` 五核心函数签名** 覆盖所有写路径
3. **provider_code 全局 UNIQUE 不动**
4. **404 vs 403 屏蔽** 别 org 资源 id 探测
5. **publish 路由 provider + KB 双校验**（已扩展到草稿链路 5 条路由）
6. **A / B 半完全并行节奏**（KB 主功能已稳定，无撞车）
7. **渗透用例 35 条**——R1 后从 15 条扩到 28 条，R2 再补双闸 / tenant_code / 零引用 7 条
8. **存量数据 backfill = NULL** 继承平台公共

三审通过 → 进入 Phase 0 实施；通不过的点继续 R3 修订。
