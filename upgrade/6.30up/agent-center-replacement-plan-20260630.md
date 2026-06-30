# 6.30up 智能体中心替换智能体管理方案

## 结论

可行性高，建议推进，但不要直接把现有 `智能体管理` 页面删掉重写。

这张原型更像一个「智能体统一运营中心」：把已发布智能体、搭建器草稿、外链智能体、外部平台接入智能体、标签分组、引用数据、常用操作统一到一个页面。当前代码已经具备大部分底层能力，尤其是 `agents`、`agent_drafts`、发布、复制、启停、删除阻断、权限适配器、标签、多知识库绑定、工作流引用反查。真正缺的是一个面向该页面的聚合 API、服务端筛选分页、中心化编辑抽屉，以及从旧入口平滑替换的迁移路径。

推荐路线：新建 `/admin/agent-center` 作为新版页面，第一期复用现有接口和发布链路；验收稳定后，把左侧菜单的「智能体管理」指向智能体中心，并保留旧 `/admin/agents` 作为兼容跳转一段时间。

## 原型拆解

原型包含这些核心能力：

1. 智能体中心首页
   - 搜索智能体名称。
   - 按类型、标签、状态、平台筛选。
   - 展示统计卡片：总数、已发布、草稿、已停用、被工作流引用。
   - 列表字段：名称、标签、状态、形态/平台、关联知识库、会话次数、更新时间、操作。
   - 右侧分组面板：按智能体分组/标签快速筛选。

2. 新增智能体
   - 本平台搭建。
   - 外链跳转。
   - 外部平台接入。
   - 基础信息：编号、名称、简介、标签。
   - 不同创建方式显示不同配置区域。

3. 编辑智能体
   - 抽屉式编辑。
   - 标签页：基础信息、知识库、知识提示词、工作流、发布设置。
   - 保存后留在当前列表上下文。

4. 高频操作
   - 复制智能体。
   - 启用/停用。
   - 删除。
   - 查看数据/分页。
   - 操作引导与成功/失败 Toast。

5. 详情页
   - 查看基础数据、关联知识库、关联工作流、消息总数、更新时间、描述。

## 现有实现对照

### 可以直接复用的能力

- `app/admin/agents/page.tsx`
  - 已有已发布智能体管理页。
  - 支持类型、标签、启停状态筛选。
  - 支持新建外链/外部接入型智能体。
  - 支持编辑基础信息、API 配置、权限范围、标签展示配置。
  - 支持启用/禁用、删除，以及被工作流引用时阻止删除。

- `app/api/admin/agents/route.ts`
  - 已有已发布智能体分页列表。
  - 返回分类、权限、平台、provider、工作流引用。
  - 对非超管做 `agent.read` 权限过滤。
  - 已处理 `published_from_draft_id` 的可见性兜底。

- `app/api/admin/agents/[id]/route.ts`
  - 支持基础字段更新、启停、删除。
  - 删除前查询 `workflow_steps`，被工作流引用时返回 409 和引用列表。
  - 启停/更新/删除都有后端权限校验和审计日志。

- `app/api/admin/agent-drafts/*`
  - 已有草稿创建、读取、更新、删除、复制、测试、发布。
  - 复制草稿会处理不可见 provider / KB 的软剥离。
  - 发布草稿会写入 `agents`、`resource_permissions`、`agent_knowledge_bases`。
  - 发布前会校验模型供应商、知识库可见性、知识库状态、发布可见范围。

- `app/admin/agent-builder/[id]/page.tsx`
  - 已有本平台搭建器。
  - 已覆盖模型设置、提示词、对话体验、知识库、发布设置。
  - 适合作为智能体中心「本平台搭建」和复杂编辑的底层能力。

- `app/admin/workflows/page.tsx`
  - 已有三类智能体分类口径：
    - `builtin`：本平台搭建器发布。
    - `external_api`：外部平台/API 接入。
    - `external_link`：外链跳转。
  - 该口径可以直接迁移到智能体中心，避免另起一套分类规则。

- `app/api/admin/agents/picker/route.ts`
  - 已有工作流选智能体的轻量 picker。
  - 目前有 2000 条硬上限，后续中心搜索不能沿用这个上限，应升级为服务端搜索。

### 当前缺口

1. 缺少智能体中心聚合 API
   - 旧 `/api/admin/agents` 只覆盖已发布智能体。
   - 原型需要同时展示已发布、草稿、停用、被引用统计。
   - 需要新接口聚合 `agents`、`agent_drafts`、`agent_categories`、`categories`、`agent_knowledge_bases`、`workflow_steps`、`conversations`。

2. 旧页面筛选方式不适合继续扩展
   - `app/admin/agents/page.tsx` 现在会循环拉取所有分页，再前端过滤。
   - 智能体数量上来后，搜索、筛选、分组、统计都应该走服务端。

3. 草稿和已发布态还没有统一列表模型
   - 已发布数据在 `agents`。
   - 草稿数据在 `agent_drafts`。
   - 原型里的「草稿」需要进入列表和统计，否则管理员无法从中心直接管理未发布内容。

4. 编辑抽屉需要明确边界
   - 基础信息、标签、启停、外链 URL 可以在中心抽屉内编辑。
   - 本平台搭建的模型、提示词、知识库、发布设置建议第一期仍复用搭建器能力，抽屉里提供摘要和「进入完整搭建器」。
   - 等中心稳定后，再逐步把搭建器局部能力组件化搬入抽屉。

5. 工作流型智能体需要谨慎处理
   - 当前 `agent_drafts.agent_type` 只有 `chat` 和 `external`。
   - 当前工作流是独立模块，智能体只是被工作流步骤引用。
   - 原型中的「工作流型」如果只是展示关联工作流，可以不迁移；如果要把工作流包装成智能体入口，需要新增数据模型和发布链路，不建议放入第一期。

## 建议的数据模型

### 第一阶段不新增主表

第一期建议优先复用现有表：

- `agents`：正式发布后的智能体。
- `agent_drafts`：搭建器草稿。
- `agent_categories` + `categories`：标签/分组。
- `resource_permissions`：发布可见范围和管理权限归属。
- `agent_knowledge_bases`：已发布智能体绑定知识库。
- `workflow_steps`：工作流引用关系。
- `conversations`：会话次数统计。

这能保证第一期基本不需要迁移，风险集中在页面和聚合查询。

### 可能需要后续迁移的场景

只有满足以下需求时才建议加迁移：

1. 要把「创建方式」做成稳定字段
   - 当前可由现有字段推导：
     - 本平台搭建：`agent_type = 'chat'` 且 `published_from_draft_id IS NOT NULL`。
     - 外部平台接入：`agent_type = 'chat'` 且 `published_from_draft_id IS NULL`。
     - 外链跳转：`agent_type = 'external'`。
   - 如果后续运营报表需要固定枚举，可新增 `agent_source` 或 `source_type`，但第一期不必。

2. 要支持真正的「工作流型智能体」
   - 可选方案是扩展 `agent_drafts.agent_type` / `agents.agent_type`，增加 `workflow`。
   - 同时要设计 `workflow_id`、前台入口、权限同步、会话归档、发布回滚。
   - 这属于二期或单独方案，不建议混在本轮替换里。

3. 要支持分组独立于标签
   - 原型右侧写的是「分类管理（智能体分组）」。
   - 当前系统已有 `categories` + `agent_categories`，可以先复用为标签/分组。
   - 如果以后要「业务标签」和「页面分组」分离，再新增 `agent_groups`。

## API 方案

### 新增智能体中心列表接口

建议新增：

`GET /api/admin/agent-center`

请求参数：

- `q`：名称/编号搜索。
- `source`：`builtin | external_api | external_link`。
- `status`：`published | draft | disabled`。
- `categoryId`：标签/分组。
- `platform`：平台。
- `page` / `pageSize`：服务端分页。

返回结构建议：

```ts
type AgentCenterItem = {
  rowKind: "agent" | "draft";
  id: string;
  agentId: string | null;
  draftId: string | null;
  agentCode: string | null;
  name: string;
  description: string;
  source: "builtin" | "external_api" | "external_link";
  status: "published" | "draft" | "disabled";
  platform: string;
  categoryIds: string[];
  categories: { id: string; name: string; iconUrl: string | null }[];
  knowledgeBaseCount: number;
  workflowRefCount: number;
  conversationCount: number;
  updatedAt: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canEnable: boolean;
  canDelete: boolean;
};
```

注意点：

- 权限过滤必须沿用 `agent` / `agent_draft` access adapter，不能只靠前端隐藏。
- 草稿统计要排除 `archived`。
- 已发布但停用的智能体状态显示为 `disabled`。
- 已发布且启用显示为 `published`。
- 草稿如果已有 `published_agent_id`，仍在草稿维度显示为可重新编辑/重新发布的草稿，但列表默认可以只展示最新一条，避免同一个智能体出现两次导致管理员困惑。

### 新增统计接口或列表接口内返回 stats

可以放在同一个 `GET /api/admin/agent-center` 返回：

```ts
type AgentCenterStats = {
  total: number;
  published: number;
  draft: number;
  disabled: number;
  workflowReferenced: number;
};
```

统计必须基于权限过滤后的可见集合，而不是全库数量。

### 新增搜索建议接口

建议第二阶段新增：

`GET /api/admin/agent-center/search?q=...`

用于顶部搜索框下拉结果，返回最多 8 到 10 条。搜索命中草稿时标注「草稿」，命中已发布时标注平台/状态。

### 新增操作封装接口

中心页面可以第一期直接调用现有接口：

- 启停：`PATCH /api/admin/agents/[id]`
- 删除已发布智能体：`DELETE /api/admin/agents/[id]`
- 删除草稿：`DELETE /api/admin/agent-drafts/[id]`
- 复制草稿：`POST /api/admin/agent-drafts/[id]/duplicate`
- 发布草稿：`POST /api/admin/agent-drafts/[id]/publish`

但建议封装一个前端 action 层，不要让页面组件到处散落不同 URL。这样后续改成 `/api/admin/agent-center/actions/*` 时不用重写 UI。

## 前端方案

### 新页面结构

新增：

- `app/admin/agent-center/page.tsx`
- `components/admin/agent-center-workbench.tsx`

页面布局：

1. 顶部区域
   - 标题：智能体中心。
   - 总数量。
   - 新增智能体按钮。

2. 筛选区域
   - 搜索框。
   - 类型、标签、状态、平台筛选。
   - 清空筛选。

3. 统计卡片
   - 总数。
   - 已发布。
   - 草稿。
   - 已停用。
   - 被工作流引用。

4. 主表格
   - 服务端分页。
   - 保留行内操作。
   - 点击名称打开详情页或右侧详情抽屉。

5. 右侧分组面板
   - 复用 `categories`。
   - 点击分组等价于设置 `categoryId`。
   - 数量从聚合接口返回，避免前端自行计算导致权限口径不一致。

### 新增智能体弹窗

创建方式建议这样落地：

1. 本平台搭建
   - 调用 `POST /api/admin/agent-drafts` 创建草稿。
   - 成功后进入 `/admin/agent-builder/[draftId]`。
   - 弹窗内只收集最少信息：名称、简介、标签、默认模型可选。
   - 不在弹窗里塞完整搭建器，避免复杂度爆炸。

2. 外链跳转
   - 可直接走 `POST /api/admin/agents`，传 `agentType = external`、`externalUrl`。
   - 后续如果希望外链也有草稿/发布审核，则改走 `agent_drafts`，但第一期可以先复用旧能力。

3. 外部平台接入
   - 复用旧 `agents` 创建和 `model_providers.category = 'agent'` 的 API 配置。
   - 表单里选择平台与命名 API，不建议在这里明文录 API Key；API Key 仍交给「API 管理」维护。
   - 如需临时兼容手填 token，也要明确它会进入现有加密字段或 provider 体系，不能新增散落密钥字段。

### 编辑抽屉

第一期建议分层实现：

- 基础信息：中心抽屉内可编辑。
- 知识库：显示绑定数量和列表摘要，本平台搭建的知识库绑定跳转搭建器处理。
- 知识提示词：显示摘要，复杂编辑跳转搭建器处理。
- 工作流：显示引用工作流，可点击跳转 `/admin/workflows?focus=...`。
- 发布设置：显示当前可见范围和状态，本平台搭建跳转搭建器发布设置。

这样能先获得原型的管理体验，又不破坏现有搭建器中已经验证过的保存/发布校验。

### 详情页

建议新增：

- `app/admin/agent-center/[id]/page.tsx`

第一期详情页可以只做只读信息：

- 基础信息。
- 标签。
- 形态/平台。
- 关联知识库数量。
- 关联工作流数量。
- 会话次数。
- 更新时间。
- 描述。

复杂编辑仍通过抽屉或搭建器进入。

## 替换路径

### Phase 1：中心只读 MVP

目标：先把智能体中心跑起来，不影响旧页面。

任务：

- 新增 `/admin/agent-center` 页面。
- 新增聚合 API `GET /api/admin/agent-center`。
- 实现搜索、筛选、分页、统计卡片、右侧分组。
- 列表同时展示已发布智能体和未归档草稿。
- 所有数量按当前管理员权限过滤。

验收：

- 超管、系统管理员、组织管理员、自定义管理员看到的数量符合权限。
- 已发布、停用、草稿数量正确。
- 搜索和筛选不需要前端拉全量数据。
- 旧 `/admin/agents` 不受影响。

### Phase 2：新增与高频操作

目标：让中心能承接旧页面的日常操作。

任务：

- 新增智能体弹窗。
- 接入本平台搭建、外链跳转、外部平台接入三种创建方式。
- 接入启用/停用、删除、复制。
- 删除仍沿用工作流引用阻断逻辑。
- 操作后刷新当前页和统计，不丢失筛选条件。

验收：

- 三种创建方式都能生成正确数据。
- 外链智能体前台仍可跳转。
- 外部平台接入仍能绑定正确 provider。
- 被工作流引用的智能体不可删除，并能展示引用列表。

### Phase 3：编辑抽屉与详情页

目标：达到原型主要交互体验。

任务：

- 实现编辑抽屉。
- 实现基础信息直接编辑。
- 知识库、提示词、发布设置先做摘要 + 跳转搭建器。
- 实现智能体详情页。
- 实现搜索建议下拉。

验收：

- 管理员不需要离开中心即可完成基础编辑。
- 本平台搭建智能体的复杂配置不绕过搭建器校验。
- 点击工作流引用可正确跳转定位。

### Phase 4：替换旧智能体管理

目标：正式用智能体中心替换旧入口。

任务：

- 左侧菜单「智能体管理」改为指向 `/admin/agent-center`。
- 旧 `/admin/agents` 保留兼容跳转，短期内不删除。
- 更新页面内所有「去智能体管理」链接。
- 对权限 key、审计日志、错误提示做一次回归。

验收：

- 旧入口访问不会 404。
- 操作审计仍记录到正确资源类型。
- 自定义管理员不会看到无权操作按钮，也不能通过接口越权。

## 权限与安全要求

智能体中心不能只做 UI 权限隐藏，必须满足：

- 已发布智能体读写仍走 `agent.read`、`agent.basic.update`、`agent.enable`、`agent.delete`。
- 草稿读写仍走 `agent_draft.read`、`agent_draft.update`、`agent_draft.publish`、`agent_draft.duplicate`、`agent_draft.delete`。
- 新建草稿必须保证创建者创建后仍有读取和编辑权限。
- 发布时必须继续校验 provider、知识库、可见范围。
- 外部平台接入不得绕过 `model_provider` 的可见性和启用状态校验。
- 删除已发布智能体前必须检查 `workflow_steps` 引用。

## 测试与验收清单

建议每个阶段至少跑：

- `npm run ci:typecheck`
- `npm run ci:lint`
- `npm run ci:test`
- `git diff --check`

权限和链路专项：

- 超管可看全量、可创建三类智能体。
- 系统管理员按权限可操作。
- 组织管理员只能看到/操作自己组织范围内资源。
- 自定义管理员仅能看到授权范围内的智能体和草稿。
- 草稿创建、复制、发布后不会出现“创建成功但自己打不开”的状态。
- 绑定不可见知识库或 provider 时，保存/发布要被后端拦截或软剥离，并给出明确提示。
- 被工作流引用的智能体删除返回 409，页面展示引用工作流。
- 统计卡片和列表数量一致。
- 服务端分页下，搜索/筛选/分组不漏数据。

## 风险点

1. 列表聚合查询复杂
   - `agents` 和 `agent_drafts` 是两套生命周期。
   - 需要避免同一个本平台智能体在已发布和草稿中重复展示造成困惑。

2. 统计口径容易和权限口径不一致
   - 所有 stats 必须基于同一套权限过滤后的集合。

3. 编辑抽屉如果一步做太深，会重复搭建器
   - 第一阶段只做基础信息和摘要跳转，更稳。

4. 外部平台接入容易和 API 管理职责重叠
   - 建议中心只绑定命名 API，不在中心直接维护密钥。

5. 工作流型智能体不是当前 schema 的现成能力
   - 如要做成正式类型，需要单独设计，不建议混入本轮替换。

## 推荐最终口径

这张原型可以做，而且方向比旧页面更适合长期运营。

但落地时要把它定义为「智能体中心」而不是「把旧智能体管理页面换个皮」。第一期先做聚合列表、统计、筛选、分组和高频操作，复杂搭建能力继续复用现有搭建器。等中心稳定后再替换左侧旧入口，这样既能实现你想要的新版体验，也不会冒险破坏已有发布、权限、知识库和工作流链路。
