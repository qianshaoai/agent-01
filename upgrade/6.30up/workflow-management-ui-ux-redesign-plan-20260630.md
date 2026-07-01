# 6.30up 工作流管理 UI/UX 优化方案

## 结论

可行性高，建议推进，但不建议把 `app/admin/workflows/page.tsx` 一次性重写成全新工作台。

工作流管理和智能体中心可以统一视觉语言：左侧标签分组、顶部筛选卡片、右侧主列表、低打扰分页、更多操作菜单、后台刷新不闪屏。但工作流管理比智能体中心多了步骤编排、流程图、绑定智能体、可见范围、工作流配置等重交互，必须保留现有权限判断和步骤编辑链路。

推荐路线修订：第一期不要拆成“纯视觉外壳”和“后补真实分页”两段交付，而是直接做「列表外壳 + 服务端筛选分页」的最小闭环。若为了快速看视觉方向先做 R1，只能作为视觉原型，不作为最终验收版本。第二期再把工作流详情、步骤列表、流程图切换收进详情抽屉或详情面板；第三期再补轻量聚合字段、用户偏好等增强项。

## 当前页面现状

核心页面：

- `app/admin/workflows/page.tsx`
  - 负责工作流列表、标签分区、筛选、新增、编辑、复制、启停、删除。
  - 负责步骤新增、编辑、删除、启停、排序、拖拽、绑定智能体。
  - 内含 `WorkflowFlowView`，用于流程图视图。

- `app/api/admin/workflows/route.ts`
  - 已有分页能力。
  - 已有 builtin / custom admin 双通道鉴权。
  - 已有 org_admin、custom admin 的可见范围过滤。
  - 已返回 `workflow_categories`、`workflow_steps`、`resource_permissions` 等列表所需数据。

- `app/api/admin/workflows/[id]/route.ts`
  - 已有更新、启停、删除等写路径。
  - 已有角色层级、组织范围、审计日志等后端保护。

- `app/api/admin/workflows-compact/route.ts`
  - 已用于工作流配置页的全量轻量候选列表，避免 `/api/admin/workflows?pageSize=200` 被分页上限截断。

## 当前主要问题

### 1. 视觉层级偏重

当前工作流按标签分区后，每个工作流又是一个大卡片，展开后再显示步骤、列表/流程图切换、标签、可见范围、步骤操作。数据一多，页面纵向很长，用户需要频繁滚动才能找目标。

### 2. 标签分组不够像管理后台

当前标签分区在主内容区内以折叠卡片呈现，适合少量标签；标签多后会挤占列表空间。智能体中心已经证明「左侧标签分组 + 右侧列表」更适合管理型页面。

### 3. 筛选和分页存在隐患

`/api/admin/workflows/route.ts` 已经分页，但页面当前只取 `d.data`，没有保存 `pagination.total/page/pageSize`。页面筛选主要在前端对已加载 `workflows` 做过滤。工作流数量超过当前 pageSize 后，搜索、标签筛选、状态筛选只覆盖当前页，不是全库搜索。

另外，当前跨页定位依赖 `/admin/workflows?focus=<wfId>&fromAgent=<agentId>&pageSize=100`。通用分页上限是 100，一旦工作流超过 100 条且改成真实分页，`focus` 目标可能不在当前页。服务端分页方案必须同时处理 `focus/fromAgent`，不能只保留 URL 参数。

### 4. 加载体验容易闪

当前 `load()` 每次会统一 `setLoading(true)`，后续如果加入分页/服务端筛选，容易出现和智能体中心之前类似的整块骨架屏刷新。需要提前区分首次加载和后台刷新。

### 5. 权限链路复杂，不能只做 UI 隐藏

当前页面已经存在 custom admin、creator hierarchy、org_admin 范围、`WorkflowFlowView` 步骤按钮权限等逻辑。改 UI 时必须复用这些判断，不能把复制、删除、启停、绑定智能体等操作绕到新的无保护入口。

现有前端 `canWorkflowAction` / `canActOnWf` 主要判断 permission key 和创建者层级，不完整覆盖 `resource_permissions` 的 org/dept/team scope 包含关系。后端写路径会兜底拒绝，但如果新 UI 只复用旧前端判断，可能出现“按钮可点但提交 403”的体验。新列表必须补行级 action 权限，或由后端直接返回每行可执行能力。

## 目标体验

### 页面整体

采用与智能体中心一致的管理后台结构：

- 顶部标题：`工作流管理`
- 右上角：
  - `工作流配置`
  - `新增工作流`
- 左侧：标签分组
  - 全部工作流
  - 未分组工作流
  - 各工作流标签
- 右侧上方：筛选卡片
  - 搜索工作流名称 / 描述 / 标签
  - 全部状态
  - 全部可见范围
  - 全部标签或保留左侧标签为主筛选
  - 清除筛选
- 右侧下方：工作流列表
  - 固定表头
  - 内部滚动
  - 底部分页
  - 切页时保留现有列表，后台更新

### 列表字段建议

| 字段 | 内容 |
| --- | --- |
| 工作流 | 名称、描述摘要、状态标记 |
| 标签 | 当前所属标签，未设置时显示未设置标签 |
| 可见范围 | 全部用户、仅组织用户、指定组织/部门/小组等 |
| 步骤 | 步骤数量、启用步骤数量、绑定智能体数量 |
| 操作 | 编辑、启停、更多 |

说明：

- 不建议在列表里默认展开所有步骤。
- 步骤详情应放在点击行后的详情区域、抽屉或展开面板。
- 列表中的数据要用于快速判断，不要把流程图直接塞进主列表。

### 操作栏建议

常驻操作：

- 编辑
- 启用 / 停用
- 更多

更多菜单：

- 复制工作流
- 删除工作流
- 步骤管理
- 可见范围
- 打开配置排序

权限要求：

- `canActOnWf(wf, "update")` 控制编辑和步骤管理。
- `canActOnWf(wf, "enable")` 控制启停。
- `canActOnWf(wf, "duplicate")` 控制复制。
- `canActOnWf(wf, "delete")` 控制删除。
- custom admin 仍按现有策略隐藏或禁用不开放的操作。

补充硬约束：

- 行级操作不能只看“是否持有 workflow.update.* 这类 key”，还必须结合该工作流 `resource_permissions` 的 scope、创建者层级、builtin/custom admin 来源。
- 推荐后端在 `/api/admin/workflows` 返回每行 `actions` 字段，例如：
  - `canUpdate`
  - `canEnable`
  - `canDuplicate`
  - `canDelete`
  - `noUpdateReason` / `noEnableReason` 等可选原因
- 如果前端自行计算，必须使用 `/api/admin/me` 返回的 `tenantCode/deptId/teamId/permissions/source` 和工作流 `permissions` 逐行计算，口径要与后端 `hasPermission` / `requireAccess` 一致。
- 无权入口要么隐藏，要么禁用并给出原因，不能留下可点击后才 403 的主要操作按钮。

### 工作流详情

第一期可以保留行内展开，但视觉上改轻：

- 点击工作流名称或详情按钮展开。
- 展开区放：
  - 基础信息
  - 标签
  - 可见范围
  - 步骤列表 / 流程图切换
  - 绑定智能体信息

第二期建议改为右侧抽屉：

- 主列表不被撑高。
- 用户可以在抽屉里完成步骤查看、步骤编辑、流程图预览。
- 抽屉关闭后仍保持当前筛选和分页位置。

## API 与数据方案

### R1：视觉原型方案，仅用于快速看方向

可以先复用当前接口快速做视觉原型：

- 继续调用 `/api/admin/workflows`
- 继续调用 `/api/admin/agents/picker`
- 继续调用 `/api/admin/wf-categories`
- 继续调用 `/api/admin/tenants`
- 继续调用 `/api/admin/departments`
- 继续调用 `/api/admin/teams`

前端完成：

- 新布局。
- 左侧标签分组。
- 列表视觉。
- 首次加载骨架屏，后续刷新保留列表。
- 当前页内筛选暂时保留，但在页面上不制造“已全库搜索”的错觉。

适合快速验收视觉方向，风险最低。

但 R1 不能作为开发开工后的最终交付口径，原因是：

- 当前页内筛选无法满足管理后台的真实搜索预期。
- 固定表头和底部分页会强化“全库列表”的用户心智。
- `focus/fromAgent` 仍可能在超过 100 条时找不到目标。
- 行级权限仍可能出现前端可点、后端拒绝的体验。

如果确实要先走 R1，页面必须明确避免“全库搜索 / 准确总数”的暗示，并且后续 R2 必须作为同一轮闭环完成。

### R2：补服务端筛选分页

在 `/api/admin/workflows/route.ts` 增加查询参数：

- `q`
- `categoryId`
- `status`
- `visible`
- `focusId`
- `page`
- `pageSize`

服务端负责：

- 搜索名称、描述、标签名称。
- 按标签过滤，支持具体 `categoryId` 和未分组 `__uncategorized__`。
- 按启用状态过滤。
- 按可见范围过滤。
- 返回准确 `pagination.total`。
- 保留 org_admin / custom admin 可见范围过滤。
- 返回行级 `actions` 能力，或返回足够前端准确计算行级能力的数据。
- 当带 `focusId` 时，不能依赖 `pageSize=100` 兜底；必须使用以下一种机制：
  - 服务端计算目标所在页，返回包含目标工作流的那一页，并在 `pagination` 中返回 `focusFound/focusPage`。
  - 或前端先通过专用接口读取目标工作流，再切换到目标所在页或打开详情。
  - 如果目标无权访问或已删除，返回可区分状态，让前端提示而不是静默失败。

前端负责：

- URL 参数或 state 驱动分页。
- 筛选变更时重置到第 1 页。
- 翻页不整块闪屏。
- 保存并展示 `pagination.total/page/pageSize`，不能丢弃分页元数据。
- `focus/fromAgent` 命中后清空可能过滤掉目标的筛选条件，打开或高亮目标，并高亮引用该 agent 的步骤。
- 空状态区分：
  - 暂无工作流。
  - 当前筛选无结果。

### R3：轻量聚合字段

如果列表需要展示更准确的数据，可以在接口返回中增加派生字段：

- `step_count`
- `enabled_step_count`
- `bound_agent_count`
- `category_names`
- `visibility_label`

这些字段也可以先在前端从 `workflow_steps`、`workflow_categories`、`permissions` 里计算。工作流数量大后再下沉到后端。

推荐一期先在前端计算 `step_count/enabled_step_count/bound_agent_count/category_names/visibility_label`，除非接口已经顺手返回。不要为了这些派生字段引入额外 N+1 请求。

## 分阶段实施

### 阶段一：列表外壳 + 服务端筛选分页最小闭环

目标：让工作流管理看起来和智能体中心属于同一套后台设计，同时解决当前页内假筛选和分页元数据缺失问题。

改动范围：

- `app/admin/workflows/page.tsx`
- `app/api/admin/workflows/route.ts`

主要改动：

- 去掉主内容区的标签分区卡片堆叠。
- 新增左侧标签分组面板。
- 顶部筛选卡片收窄、增强输入框可见性。
- 主列表改成固定表头 + 内部滚动 + 底部分页的管理列表。
- 保留现有新增、编辑、复制、启停、删除、步骤编辑函数。
- 后端支持 `q/categoryId/status/visible/focusId/page/pageSize`。
- 前端保存并使用 `pagination.total/page/pageSize`。
- 首次加载显示骨架屏，翻页、筛选、切换标签时保留旧列表并用轻量刷新状态。
- 行级操作使用后端 `actions` 或等价的 scope-aware 前端计算结果。
- 保留 `focus/fromAgent` 定位能力，不再依赖 `pageSize=100` 覆盖目标。

验收标准：

- 页面首屏能看到标题、标签分组、筛选、列表。
- 不需要滚动很久才能看到分页。
- 标签切换、搜索、状态、可见范围筛选覆盖所有当前可见工作流，不限当前页。
- 分页总数、总页数、当前页准确。
- custom admin 无权操作仍不会出现可执行入口。
- 从智能体中心跳转 `focus/fromAgent` 后能定位并高亮目标工作流和引用步骤；无权或目标不存在时有明确提示。

### 阶段二：详情与步骤区收口

目标：减少主列表高度，让步骤管理更像详情操作，而不是把所有内容摊在页面里。

改动范围：

- `app/admin/workflows/page.tsx`
- 内部 `WorkflowFlowView`

主要改动：

- 点击工作流行打开详情抽屉或详情面板。
- 详情内保留步骤列表 / 流程图切换。
- 绑定智能体、步骤启停、步骤排序仍复用现有函数。
- 抽屉关闭后保留当前筛选、分页、滚动位置。
- 审计 `WorkflowFlowView` 内所有会触发 PATCH/POST/PUT/DELETE 的入口：
  - 添加 / 插入步骤
  - 编辑 / 删除步骤
  - 步骤启停
  - 上移 / 下移 / 拖拽排序
  - 绑定 / 重新绑定智能体
- 上述入口必须统一吃 `canEditSteps` / `isCustomAdmin` / 行级 actions，不能只依赖后端 403 兜底。

验收标准：

- 主列表稳定，不因展开多个工作流而被撑长。
- 步骤操作入口清晰。
- 流程图不会挤压列表，也不会造成页面横向滚动。
- 无 `workflow.update.*` 或 scope 不匹配的账号，不能在流程图或详情里看到可执行的步骤写入口。

### 阶段三：轻量聚合与体验增强

目标：减少前端重复计算，让列表在数据量继续增长后仍然稳定。

改动范围：

- `app/api/admin/workflows/route.ts`
- `app/admin/workflows/page.tsx`

主要改动：

- 后端可选返回 `step_count/enabled_step_count/bound_agent_count/category_names/visibility_label`。
- 支持保存用户上次选择的列表密度、每页条数、详情视图模式。
- 工作流配置入口增加提示：用于组织/部门/小组展示和排序，不等同于工作流可见范围编辑。

验收标准：

- 派生字段准确，不引入额外 N+1 请求。
- 关闭详情后仍保持筛选、分页、滚动位置。
- 工作流配置入口和可见范围编辑在文案和权限上不混淆。

### 阶段四：可选增强

可选项：

- 工作流列表增加“数据详情”按钮，展示步骤、绑定智能体、可见范围。
- 支持从智能体中心跳转过来时自动定位工作流，并打开详情抽屉。
- 支持更细的服务端智能体绑定搜索，解决 `/api/admin/agents/picker` 超过 hard cap 后无法搜索全部智能体的问题。

## 权限与风险清单

### 必须保留的权限逻辑

- `canWorkflowAction`
- `canActOnWf`
- `noTouchReason`
- `isCustomAdmin`
- `WorkflowFlowView` 的 `canEditSteps` / `isCustomAdmin`
- `resource_permissions` 的 org/dept/team scope 包含关系
- 创建者层级 `created_by_role`
- `/api/admin/me` 返回的 `source/permissions/tenantCode/deptId/teamId`
- 后端 `requireAccess` / `hasPermission` 的最终兜底
- 后端 `app/api/admin/workflows/[id]/route.ts` 的写权限校验
- 后端 `app/api/admin/workflow-steps/[id]/route.ts` 的步骤写权限校验
- 后端 `app/api/admin/workflows/[id]/steps/route.ts` 的步骤新增和重排权限校验
- 后端 `app/api/admin/workflows/[id]/duplicate/route.ts` 的复制权限校验

### 不能踩的坑

1. 不能为了好看把步骤编辑按钮移到新组件后绕过权限判断。
2. 不能把 custom admin 原本隐藏的复制、删除、启停操作重新露出来。
3. 不能把服务端分页数据再包装成“全量前端筛选”。
4. 不能把工作流配置和工作流可见范围混成一个概念。
5. 不能让从智能体中心跳转 `focus/fromAgent` 的定位能力失效。
6. 不能在列表里默认展示全部步骤，工作流多时会直接拖垮页面。
7. 不能只按 permission key 显示按钮，忽略目标工作流的 scope，导致点了才 403。
8. 不能让 `WorkflowFlowView` 的“绑定 / 重新绑定智能体”在无 update 权时仍可点击。
9. 不能把搜索框写成“名称 / 描述 / 标签”，但后端只搜名称和描述。
10. 不能把“未设置标签”只做前端当前页兜底；服务端标签筛选也要能表达未分组。

## 建议优先级

建议先做阶段一的最小闭环：

1. 视觉外壳统一到智能体中心风格。
2. 服务端补真实搜索、标签筛选、状态筛选、可见范围筛选和分页。
3. 前端保存分页元数据，首次加载骨架屏，后续切换保留列表。
4. 左侧标签分组和顶部筛选互相配合。
5. 行级操作权限补成 scope-aware。
6. `focus/fromAgent` 定位不再依赖 `pageSize=100`。

步骤抽屉可以放到第二轮，因为它涉及 `WorkflowFlowView` 的交互重排，风险比列表外壳更高。

## 初始验收清单

- 超级管理员能看到所有工作流。
- 组织管理员只能看到自己范围内可见工作流。
- custom admin 只能看到有 `workflow.read.*` 权限的工作流。
- 无更新权限或 scope 不匹配时不能编辑工作流，也不能编辑步骤。
- 无启停 / 复制 / 删除权限或 scope 不匹配时，对应入口不可执行。
- 搜索名称、描述、标签结果正确，并覆盖所有可见工作流。
- 标签、未分组、状态、可见范围筛选结果正确。
- 分页总数、总页数、当前页准确。
- 翻页时页面不闪成骨架屏。
- 左侧菜单切换不会触发后台主内容淡入刷新感。
- 从智能体中心点击工作流引用后，仍能定位并高亮目标工作流。
- 从智能体中心带 `fromAgent` 跳转后，仍能高亮引用该智能体的步骤。
- 超过 100 条工作流时，`focus` 目标不在第一页也能定位；无权或已删除时有明确提示。
- `WorkflowFlowView` 中绑定 / 重新绑定智能体入口受 `canEditSteps` 控制。
- R1 视觉原型不能作为最终验收；最终交付必须包含 R2 的真实服务端筛选分页。
- lint/typecheck 通过。
