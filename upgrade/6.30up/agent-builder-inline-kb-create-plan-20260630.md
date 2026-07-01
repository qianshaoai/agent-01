# 智能体搭建内联创建知识库方案（2026-06-30）

## 结论

可行，而且建议做；但首期交付必须是“创建-可见范围-引用-保存-上传回流”的完整闭环，不能只做名称/描述创建后本地勾选。

当前智能体搭建页在「5. 知识库」分区只提供已有知识库多选；如果没有可选知识库，用户必须离开搭建器去「知识库管理」新建，再返回搭建器刷新/重新勾选。这会打断创建智能体的连续流程。

现有系统已经具备主要基础：

- `GET /api/admin/knowledge-bases?purpose=bind` 可返回当前管理员可绑定的知识库，后端会通过 `canAdminUseKnowledgeBase` 过滤可见/可用范围。
- 草稿通过 `builder_config.knowledge_base_ids` 保存绑定意图。
- `PATCH /api/admin/agent-drafts/{id}` 会校验草稿里的 `knowledge_base_ids` 是否可访问。
- 发布时会再次校验草稿里的 `knowledge_base_ids`，并同步到 `agent_knowledge_bases`。
- 知识库编辑接口已经支持 `visibilityScopes`，并通过 `resource_permissions` 落库。

因此本需求不需要先改 embedding、切片、发布表结构，也不需要新增核心数据表。真正要补的是：把知识库创建入口前移到智能体搭建器，同时补齐创建时可见范围、引用保存、上传回流和失败处理。

## 开工前置

1. 数据库必须已执行 `supabase/migration_v56_kb_visibility_permissions.sql`。
   - 该迁移允许 `resource_permissions.resource_type = 'knowledge_base'`。
   - 如果未执行，创建/编辑知识库可见范围会在写 `resource_permissions` 时失败。
2. 前端权限键和后端资源名要区分清楚。
   - 前端按钮判断使用 `useAdminPermissions().canAction("kb", "create")`，对应 `kb.create.org/all`。
   - 后端继续使用 access adapter 的资源名：`requireAccess(actor, "knowledge_base", "create")`。
3. 本次不新增 `agent_knowledge_bases` 写入入口。
   - 搭建器阶段只写草稿 `builder_config.knowledge_base_ids`。
   - 正式绑定仍由发布接口统一同步。

## 目标体验

在智能体搭建页的「知识库」分区增加一个「新建知识库」按钮。

用户点击后：

1. 在当前页面打开新建知识库弹窗。
2. 填写知识库名称、描述、可见范围。
3. 创建成功后弹出确认：
   - 「引用到当前智能体」
   - 「仅创建，不引用」
   - 「去上传文档」
4. 如果选择「引用到当前智能体」：
   - 新知识库加入当前知识库列表。
   - 自动勾选到 `draft.builder_config.knowledge_base_ids`。
   - 立即保存草稿，确保刷新后绑定仍存在。
   - 如果保存失败，明确提示“知识库已创建，但未能引用到当前智能体”，并提供重试。
5. 如果选择「去上传文档」：
   - 推荐先引用到当前智能体并保存草稿，再跳转 `/admin/knowledge-bases/{id}?from=agent-builder&draftId={draftId}`。
   - 如果保存失败，阻止跳转并提示用户重试，避免用户返回后绑定丢失。

## 页面改造

### 1. 搭建器知识库分区

位置：`app/admin/agent-builder/[id]/page.tsx` 的「5. 知识库」分区。

建议在 `Field label="绑定知识库"` 右侧或列表上方增加：

- `新建知识库` 主按钮：仅当 `canAction("kb", "create")` 为 true 时显示。
- `刷新列表` 次按钮：可选，用于用户刚从知识库详情页返回后手动刷新。

空状态文案调整为：

- 有创建权限：`暂无可绑定知识库。你可以直接新建一个知识库，并选择是否引用到当前智能体。`
- 无创建权限：`暂无可绑定知识库，请联系有知识库创建权限的管理员配置。`

不要再只提示用户跳去「知识库管理」。

### 2. 知识库列表状态

当前搭建器只保留 `{ id, name, status }`，会丢掉 `document_count`。本次需要把列表状态扩展为：

```ts
type BindableKnowledgeBase = {
  id: string;
  name: string;
  status: string | null;
  document_count: number;
};
```

列表展示要求：

- `document_count === 0` 时显示 `未上传文档`。
- 0 文档知识库提供 `去上传` 快捷入口，仍跳转到知识库详情页，不在搭建器里直接实现上传。
- disabled 知识库沿用现有规则：已绑定可取消，不可新绑定。

### 3. 新建知识库弹窗

弹窗字段必须和知识库管理页一致：

- 名称，必填，沿用 100 字上限。
- 描述，可选。
- 可见范围：
  - 全部可见
  - 指定组织/部门/小组可见

知识库管理页目前新建弹窗只创建名称/描述，编辑弹窗才有可见范围。为了避免两边规则漂移，需要把可见范围能力抽成公共组件，例如：

- `components/admin/kb-visibility-scope-editor.tsx`
- 或从 `components/admin/knowledge-base-workbench.tsx` 中提炼 `VisibilityScopeEditor`、`KbVisibilityScope`、`normalizeVisibilityScopes`、`summarizeVisibility`

搭建器创建弹窗、知识库管理页新建弹窗、知识库管理页编辑弹窗都共用这一套组件。

### 4. 创建后确认引用

创建成功后不要静默勾选，也不要只 toast。需要明确弹出二次确认：

标题：`知识库已创建`

内容：

- 显示新知识库名称。
- 显示文档数为 0 的提示：`该知识库还没有文档，上传文档后才会参与有效检索。`
- 提醒：`是否将该知识库引用到当前智能体？引用后，对话时会参与知识库检索。`

按钮：

- `引用到当前智能体`
- `仅创建`
- `去上传文档`

默认推荐按钮：`引用到当前智能体`。用户是在搭建智能体时创建知识库，大多数情况下就是为了当前智能体使用，但仍要保留“只是先建库”的自由。

### 5. 上传回流

`app/admin/knowledge-bases/[id]/page.tsx` 当前只把 `initialKbId` 传给 `KnowledgeBaseWorkbench`，不会消费来源参数。本次需要补齐：

- 读取 `from=agent-builder&draftId={draftId}`。
- 在知识库详情页顶部显示 `返回智能体搭建`。
- 返回地址为 `/admin/agent-builder/{draftId}`。
- 返回后搭建器刷新 `GET /api/admin/knowledge-bases?purpose=bind`，并保持草稿中已有绑定。

## 后端改造

### 1. 创建接口支持可见范围

目标接口：`app/api/admin/knowledge-bases/route.ts` 的 `POST`。

当前 `POST` 只接收 `name`、`description`、`tenant_code`，没有在创建时处理 `visibilityScopes`。本次必须增强为：

```http
POST /api/admin/knowledge-bases
Content-Type: application/json

{
  "name": "...",
  "description": "...",
  "visibilityScopes": [
    { "scope_type": "all", "scope_id": null }
  ]
}
```

处理要求：

1. 创建前读取并校验 `visibilityScopes` 或 `visibility_scopes`。
2. 使用和编辑接口一致的 `normalizeKbVisibilityInputForAdmin`。
3. 插入 `knowledge_bases` 成功后调用 `replaceKbVisibilityScopes` 写 `resource_permissions`。
4. 如果可见范围写入失败，删除刚创建的知识库或用事务回滚，不能返回“创建成功但可见范围失败”的半成功状态。
5. audit 日志需要记录创建来源和可见范围摘要，便于排查权限问题。
6. 返回体包含 `document_count: 0`，供搭建器立即渲染。

### 2. 权限规则

后端仍以 `POST /api/admin/knowledge-bases` 为准：

- org 管理员只能创建本组织归属知识库。
- system/super 可按现有规则创建公共或指定组织归属知识库。
- custom admin 走现有 v2 权限校验。
- 可见范围必须经过 `canActorSetVisibilityScope`，不能由前端传什么就写什么。

绑定时不新增特殊权限：

- 创建成功的知识库理论上应当对创建者可见。
- `PATCH /api/admin/agent-drafts/{id}` 仍会校验 `knowledge_base_ids` 是否有权访问。
- 发布时仍由 `publish` 路由硬校验，避免越权引用。

## 数据流

### 创建

1. 搭建器弹窗提交 `POST /api/admin/knowledge-bases`。
2. 后端创建知识库并写入可见范围。
3. 返回新知识库对象，至少包含 `id`、`name`、`status`、`document_count`。
4. 前端把新知识库插入 `knowledgeBases` 列表。
5. 弹出创建后确认弹窗。

### 引用到当前智能体

创建成功拿到 `kb.id` 后：

1. 更新本地 `knowledgeBases`。
2. 更新草稿 `builder_config.knowledge_base_ids`，避免重复插入。
3. 立即调用当前草稿保存逻辑，实际请求仍是 `PATCH /api/admin/agent-drafts/{id}`。
4. 保存成功后 toast：`已创建并引用到当前智能体`。
5. 保存失败时保留知识库列表项，但不要声称引用成功；展示重试入口。

这里不直接写 `agent_knowledge_bases`，因为当前还处于草稿阶段。正式关联由发布接口同步。

### 去上传文档

用户选择「去上传文档」时：

1. 如果尚未引用，先按“引用到当前智能体”流程保存草稿。
2. 保存成功后跳转 `/admin/knowledge-bases/{kb.id}?from=agent-builder&draftId={draftId}`。
3. 知识库详情页显示返回按钮，回到 `/admin/agent-builder/{draftId}`。
4. 如果保存失败，不跳转，提示用户重试。

## 文档上传边界

本次不把“上传文档”塞进智能体搭建器。

理由：

- 知识库文档上传涉及文件大小、格式、切片、embedding、状态轮询、重建、删除等完整管理流程。
- 知识库管理页已有文档列表和上传处理，直接跳转复用更稳。

首期只做：

- 搭建器内创建知识库。
- 创建时配置可见范围。
- 创建后可立即引用并保存草稿。
- 提供「去上传文档」跳转。
- 上传后可返回搭建器，绑定状态不丢。

## 实施步骤

### 阶段 1：完整主链路

1. 抽出知识库可见范围公共组件。
2. 知识库管理页新建/编辑弹窗统一使用该组件。
3. 增强 `POST /api/admin/knowledge-bases` 支持 `visibilityScopes`，并补齐失败回滚。
4. 搭建器知识库分区增加「新建知识库」按钮。
5. 搭建器新建弹窗接入名称、描述、可见范围。
6. 创建成功后弹出「引用到当前智能体 / 仅创建 / 去上传文档」确认。
7. 选择引用后更新本地列表和草稿，并立即保存草稿。
8. 列表保留并展示 `document_count`，0 文档显示 `未上传文档` 和上传入口。
9. `去上传文档` 跳转前确保草稿保存成功。

### 阶段 2：上传回流体验

1. 从搭建器跳到知识库详情页时带 `from=agent-builder&draftId={draftId}`。
2. 知识库详情页展示「返回智能体搭建」按钮。
3. 返回后搭建器刷新知识库列表并保留当前绑定。

### 阶段 3：体验增强，可后置

1. 知识库列表支持一键刷新。
2. 对 0 文档知识库增加更明显的状态说明。
3. 创建后确认弹窗中增加“稍后上传”的轻提示。

## 验收标准

- 已执行 v56 迁移后，创建知识库可正常写入 `resource_permissions.resource_type = 'knowledge_base'`。
- 有 `kb.create.org/all` 权限的管理员能在智能体搭建页看到并使用「新建知识库」。
- 无创建权限用户看不到或无法点击创建入口；即使绕过前端，后端也拒绝创建。
- 搭建器创建弹窗支持名称、描述、可见范围。
- 创建时传入指定可见范围后，`resource_permissions` 正确落库。
- org/custom 管理员不能越权创建平台公共库或设置无权设置的可见范围。
- 创建成功后选择「引用到当前智能体」，当前知识库列表立即出现该库并自动勾选。
- 引用后立即保存草稿；刷新页面后绑定仍存在。
- 如果保存草稿失败，界面提示“知识库已创建，但未能引用到当前智能体”，并提供重试。
- 发布智能体后，`agent_knowledge_bases` 出现对应绑定。
- 选择「仅创建」不会污染当前草稿绑定。
- 选择「去上传文档」能进入新知识库详情页，上传文档后可返回搭建器。
- 0 文档知识库在搭建器列表中显示 `未上传文档`，并提供上传入口。
- disabled 知识库仍沿用现有规则：已绑定可取消，不可新绑定。

## 风险与处理

- **风险：v56 未执行导致可见范围写入失败。**  
  处理：把 v56 作为上线前置；验收时必须覆盖创建并写 `resource_permissions`。

- **风险：创建成功但可见范围写入失败。**  
  处理：后端做事务或失败补偿删除，不能留下半成功知识库。

- **风险：创建成功但引用保存失败。**  
  处理：引用动作必须落到 `PATCH /api/admin/agent-drafts/{id}`；保存失败时提示“知识库已创建，但未能引用到当前智能体”，并保留重试。

- **风险：创建时可见范围和编辑页规则不一致。**  
  处理：抽公共前端组件，后端复用 `normalizeKbVisibilityInputForAdmin` 和 `replaceKbVisibilityScopes`。

- **风险：搭建器丢掉 `document_count`，用户误以为已可回答。**  
  处理：保留 `document_count`，0 文档显示 `未上传文档` 和上传入口。

- **风险：上传跳转带了来源参数但详情页不处理。**  
  处理：知识库详情页必须消费 `from=agent-builder&draftId={draftId}`，并渲染返回按钮。

- **风险：跳转上传导致草稿未保存。**  
  处理：跳转前先保存草稿；保存失败则阻止跳转。

## 推荐落地顺序

建议按“后端闭环优先、前端接入其次、回流体验收口”的顺序开工：

1. 先确认 v56 已执行，并增强 `POST /api/admin/knowledge-bases` 支持 `visibilityScopes`。
2. 抽公共可见范围组件，同步改造知识库管理页新建/编辑弹窗。
3. 改搭建器知识库分区，接入创建弹窗和创建后确认。
4. 打通引用后立即保存草稿、失败重试、0 文档提示。
5. 最后补上传页返回入口。

完成以上后，这个需求可以作为 6.30up 的独立开发任务开工。
