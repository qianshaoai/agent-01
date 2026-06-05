### 6.3up 变更记录 · 工作流分层级配置（组织 / 部门 / 小组）+ 可见性统一收口

日期：2026-06-03
分支：`feature/6.3up`
依据：[方案-工作流分层级配置-20260603.md](./方案-工作流分层级配置-20260603.md)
Plan：`C:\Users\Admin\.claude\plans\snappy-jumping-pascal.md`
位置：`upgrade/6.3up/`
版本：R1.11（含 R1.10 之前全部 + R1.11 org_admin 后台工作流列表叠加 visible_to='all'）

---

## 背景

用户原话："我想给每个组织按照不同部门展示不同工作流，我该怎么做"。

R0 → R1 → R1.1 评审收口：
- 选 **路径 P1**：拉取 = 同步写 `resource_permissions`（管"可见"）+ `workflow_scope_order`（管"排序"）；UI 入口一体，DB 表解耦
- Finding 2 范围放大：5 处工作流可见性判定不一致，做成**统一 helper**一次收齐
- 决策点：1(a) 排序各 scope 独立 / 2(b) 不做 user 维度 / 3(a) 仅 super+system 写 / 4(b) 一体 / 5(a) 不加侧栏 / 6(a) 兜底全局 sort_order / 7 工作流粒度不细化到分类

---

## 实施

### Phase -1 · DB · [supabase/migration_v46_workflow_scope_order.sql](../../supabase/migration_v46_workflow_scope_order.sql)

新表：

```sql
CREATE TABLE workflow_scope_order (
  scope_type  TEXT  CHECK IN ('org','dept','team'),
  scope_id    TEXT  -- org=tenant_code / dept,team=UUID 转 TEXT 与 resource_permissions 对齐
  workflow_id UUID  REFERENCES workflows(id) ON DELETE CASCADE,
  sort_order  INT,
  PRIMARY KEY (scope_type, scope_id, workflow_id)
);
```

2 个 RPC：

- `get_user_workflow_order(p_user_id UUID)` → 用户维度层级回退 team>dept>org 取最具体排序（DISTINCT ON + CASE 优先级）
- `batch_reorder_workflow_scope(scope_type, scope_id, ordered_ids[])` → 批量重排事务（DELETE + INSERT 避主键冲突）

[supabase/MIGRATIONS.md](../../supabase/MIGRATIONS.md) 加 v46 条目。

### Phase 3 · 统一可见性 helper · [lib/workflow-visibility.ts](../../lib/workflow-visibility.ts) 【新建】

`UserVisibilityCtx`：`{userId, tenantCode, isPersonal, role, deptId, teamId, groupIds}`

三个导出：
- `buildVisibilityCtx(user)` — 从 ActiveUser / UserPayload 派生 ctx（dept/team/group 查 DB）
- `filterVisibleWorkflows(workflows[], ctx)` — 批量返回可见 ID 集合（一次 DB round-trip）
- `isWorkflowVisible(id, visibleTo, ctx)` — 单个判定（chat route 路径用）
- `visibleWorkflowAgentIds(workflowIds[])` — 给定可见工作流 → 取 enabled 步骤的 agent_id 集合

口径（评估顺序）：
1. `system_admin` → 全放行
2. `org_admin` + 工作流在本组织/部门/小组的 permissions → 放行（5.7up 豁免）
3. `visible_to='all'` → 放行
4. `visible_to='personal_only'` → isPersonal 放行
5. `visible_to ∈ {'org_only','custom'}` → 查 `resource_permissions` 命中（all/user_type/org/dept/team/user/group）
6. 兼容旧数据：逗号分隔租户码 → 命中 tenantCode 放行
7. 其余 → 不可见

**关键修复**：步骤 5 把 `org_only` 拉齐到查 permissions（旧版直接 `return !isPersonal` 跨组织泄露）。P1 路径下配置页同步写 permissions，业务上不会回归；存量纯 `org_only` 工作流由步骤 6 的兼容兜底接住。

### Phase 3 · 5 落点改造（统一调 helper）

| 落点 | 改动 |
|---|---|
| [`app/api/workflows/route.ts`](../../app/api/workflows/route.ts) | 删 5.7up org_admin 豁免 + 各 visible_to 分支（已内化到 helper），改 `filterVisibleWorkflows`；同时挂上 Phase 4 排序回退 |
| [`app/api/workflows/[id]/steps/route.ts`](../../app/api/workflows/%5Bid%5D/steps/route.ts) | **新增可见性闸门**：select 加 `visible_to`，拿到工作流后调 `isWorkflowVisible`，false → 404 |
| [`app/api/workflow-sessions/route.ts`](../../app/api/workflow-sessions/route.ts) | **新增可见性闸门**：POST 创建会话前 `isWorkflowVisible`，false → 404 |
| [`app/api/agents/route.ts`](../../app/api/agents/route.ts) | 修复最旧口径（只看 visible_to 字面值不查 permissions）→ 用 helper。分类页智能体不再泄露其他组织的 `org_only` 工作流的步骤 agent |
| [`app/api/agents/[id]/chat/route.ts`](../../app/api/agents/%5Bid%5D/chat/route.ts) | 工作流兜底放行 2a/2b 分支统一为 `filterVisibleWorkflows(wfRows, ctx)`，自动覆盖 `org_only`/`custom` |

### Phase 4 · 前台 /api/workflows 排序回退（合并到 Phase 3 改造中）

- 调 RPC `get_user_workflow_order(user.userId)` 得 `{workflow_id, sort_order}` map
- 最终排序：`COALESCE(scopeOrderMap[id], workflows.sort_order, 999999) ASC, id ASC`
- `system_admin` 跳过排序

### Phase 0 · 后端 API（3 个文件）

**新建 [`app/api/admin/workflow-scope-order/route.ts`](../../app/api/admin/workflow-scope-order/route.ts)**：
- `GET ?scope_type=X&scope_id=Y` — 该 scope 已配置工作流（含 sort_order + 工作流名/描述/启停 + missing 标记已删除工作流）
- `POST {scope_type, scope_id, workflowIds[]}` — 同步写两张表：
  - `workflow_scope_order` 增量插入（sort_order 接末尾，幂等跳过已存在）
  - `resource_permissions` 增量插入（幂等跳过已存在）
- `PUT {scope_type, scope_id, orderedIds[]}` — 调 RPC `batch_reorder_workflow_scope` 事务化
- `DELETE {scope_type, scope_id, workflowId}` — 同步删两张表
- 权限：`isWorkflowConfigAdmin`（super + system_admin）
- scope 归属校验：dept 必须属于 org / team 必须属于 dept
- 审计：每个写操作写一条 `workflow_scope_order` 审计

**新建 [`app/api/admin/scope-tree/route.ts`](../../app/api/admin/scope-tree/route.ts)**：
- `GET` — 返回 tenants → departments → teams 嵌套树（左侧导航用）

**改 [`lib/admin-permissions.ts`](../../lib/admin-permissions.ts)**：加 `isWorkflowConfigAdmin(role)`（super + system_admin）

**改 [`lib/audit.ts`](../../lib/audit.ts)**：`AuditResourceType` union 加 `'workflow_scope_order'`

### Phase 1 · 后台 UI · [app/admin/workflow-config/page.tsx](../../app/admin/workflow-config/page.tsx) 【新建 ~480 行】

- 顶部 `PageHeader` · 标题「工作流配置」+ 副标题「按组织 / 部门 / 小组分层级配置展示与排序」
- 双栏布局（lg:col-span-4 / 8）：
  - 左：三栏导航 = 组织卡片 → 部门卡片（可选） → 小组卡片（可选），层级 active 高亮，可"← 只配置上一层级"回退
  - 右：当前 scope 的已配置工作流卡片列表（拖拽 + 移除 + sort_order 标签 + 已停用 / 已删除 标识）
  - 右上「+ 添加工作流」按钮 → `AddWorkflowModal`
- `AddWorkflowModal`：fetch `/api/admin/workflows?pageSize=200`，搜索过滤已存在 ID，勾选批量确认
- 角色 guard：me.role 不属于 super/system_admin 时 redirect → /admin/dashboard
- 复用：`AdminLayout` / `PageHeader` / `Card` / `Button` / `useToast` / `useSubmitGuard`

### Phase 2 · 工作流管理入口按钮 · [app/admin/workflows/page.tsx](../../app/admin/workflows/page.tsx)

PageHeader actions 新增「分层级配置」按钮（`<Layers size={16} />` outline 样式）：
- 仅 `adminRole ∈ {super_admin, system_admin}` 显示（与服务端 `isWorkflowConfigAdmin` 一致）
- 点击 `router.push("/admin/workflow-config")`

### Phase 5 · CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（唯一遗留 warning [`app/agents/[id]/page.tsx:778`](../../app/agents/%5Bid%5D/page.tsx) 与本期无关）

---

## 改动文件清单

| 类型 | 文件 | 备注 |
|---|---|---|
| 新建 | `supabase/migration_v46_workflow_scope_order.sql` | 表 + 2 RPC + NOTIFY |
| 改 | `supabase/MIGRATIONS.md` | 加 v46 条目 |
| 新建 | `lib/workflow-visibility.ts` | 统一可见性 helper |
| 改 | `lib/admin-permissions.ts` | 加 `isWorkflowConfigAdmin` |
| 改 | `lib/audit.ts` | `AuditResourceType` 加 `'workflow_scope_order'` |
| 改 | `app/api/workflows/route.ts` | 用 helper + 加排序 + limit 后置 |
| 改 | `app/api/workflows/[id]/steps/route.ts` | 新增可见性校验 |
| 改 | `app/api/workflow-sessions/route.ts` | POST 新增可见性校验 |
| 改 | `app/api/agents/route.ts` | 修复 `org_only` 跨组织泄露 |
| 改 | `app/api/agents/[id]/chat/route.ts` | 工作流兜底放行统一到 helper |
| 新建 | `app/api/admin/workflow-scope-order/route.ts` | CRUD（同步写 permissions）+ 审计 + 事务化重排 |
| 新建 | `app/api/admin/scope-tree/route.ts` | 嵌套树 |
| 新建 | `app/admin/workflow-config/page.tsx` | 后台主 UI（~480 行） |
| 改 | `app/admin/workflows/page.tsx` | 头部加「分层级配置」按钮 |
| 新建 | `upgrade/6.3up/方案-工作流分层级配置-20260603.md` | R0 → R1 → R1.1 方案（前置 commit） |
| 新建 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md` | 本文件 |

---

## 上线步骤（开发环境 supabase 项目 `ysgdmdqygbvfthzylhqn`）

1. 在 Supabase Dashboard > SQL Editor 跑 [`supabase/migration_v46_workflow_scope_order.sql`](../../supabase/migration_v46_workflow_scope_order.sql)
2. 在 [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md) 把 v46 的 ☐ 改成 ✅ + 跑过日期
3. dev 起服务（`npm run dev`）→ 实测 15 项验收（见 plan）

---

## 验收（15 项 · 待用户人工实测）

**配置页主路径**
1. `/admin/workflow-config` 能打开（super + system_admin）；org_admin 跳 `/admin/dashboard`
2. 三栏导航：选组织 → 显示部门 → 选部门显示小组；可"← 只配置上一层级"
3. 选定 scope 后右侧显示该 scope 已配置工作流（含 sort_order 标签）
4. 「+ 添加工作流」弹窗多选确认 → supabase 直接 SELECT：`workflow_scope_order` 和 `resource_permissions` 两张表都新增了行
5. 拖拽工作流卡片排序 → 拖完立即 PUT；刷新仍保持顺序
6. 从 scope 移除工作流 → 同时删 order 行 + permissions 行；该 scope 用户立即看不到
7. `audit_logs` 有完整 N 条 `workflow_scope_order` 写记录（create / update / delete + scope_type/scope_id detail）
8. 工作流管理头部「分层级配置」按钮只对 super/system_admin 显示

**可见性 helper 回归**
9. 前台用户：`visible_to='org_only'` 工作流在被配置的部门可见，**未被配置的部门不可见**（修复 `/api/workflows/route.ts:137` 旧 bug）
10. 前台用户：分类页智能体列表不再泄露其他组织 `org_only` 工作流的步骤 agent（修复 `/api/agents/route.ts:142-145` 最旧口径）
11. `GET /api/workflows/[id]/steps` 对不可见工作流返回 404（新增防护）
12. `POST /api/workflow-sessions` 对不可见工作流返回 404（新增防护）
13. 工作流步骤上的非外链 agent 走 `/agents/[code]/chat`：可见路径仍能聊；`org_only`/`custom` 工作流在被配置组织能聊，未被配置不能聊

**排序回退**
14. 前台用户工作流列表按 team→dept→org→workflows.sort_order 回退顺序展示（未配置工作流接在已配置之后）
15. 删除部门 / 小组（cascade）后，`workflow_scope_order` 对应行被自动删（因为外键到 workflows.id；部门 / 小组本身的删除靠 ON DELETE 行为传到 users）— 不影响其他 scope 的 order 数据

---

## 下一步

1. 用户人工实测 15 项
2. 通过 → 与 6.2up + 6.3up（agent-builder + 知识库 + 卡片精简 + 标签管理）合并 PR → master2
3. 上线时按 [上线步骤](#上线步骤开发环境-supabase-项目-ysgdmdqygbvfthzylhqn) 跑 v46 + v47

---

## R1.2 增量 · 小B R1.1 评审 4 finding 修复（2026-06-03 当天）

### Finding 1（High）· `org_only` 历史数据隐身 · 修法 A · helper 内兜底

[`lib/workflow-visibility.ts`](../../lib/workflow-visibility.ts) 步骤 5 拆成 5a / 5b：

```ts
// 5a. org_only · 无 perms 时沿用旧"所有组织用户可见"语义
if (vt === "org_only") {
  const rules = permMap.get(wf.id) ?? [];
  if (rules.length === 0) {
    if (!ctx.isPersonal && ctx.tenantCode) visible.add(wf.id);
    continue;
  }
  // 有 perms（已被纳入分层级配置）→ 严格判定
  if (rules.some((r) => matchPermRule(r, ctx))) visible.add(wf.id);
  continue;
}
// 5b. custom · 创建路径强制写 perms，无兜底
if (vt === "custom") {
  const rules = permMap.get(wf.id) ?? [];
  if (rules.some((r) => matchPermRule(r, ctx))) visible.add(wf.id);
  continue;
}
```

行为对照：
- 历史 `org_only` 工作流 · 未配过分层级 → 所有组织用户仍可见（与升级前一致）
- 一旦该工作流被配置页"添加"过任一层级 → 转入严格 perms 判定（管理员有意识动作）
- `custom` 行为不变（必须命中 perms）

### Finding 2（High）· `.limit(500)` 截断顺序问题 · 修法 A · 去掉 limit

[`app/api/workflows/route.ts:20`](../../app/api/workflows/route.ts) 去掉 `.limit(500)`，注释说明：业务上 enabled 工作流总量在百级，全量拉的成本可接受；未来真上千级再上分页。

修复后：team / dept scope 排第 1 但全局排第 600 的工作流也能正常出现并按层级排序展示。

### Finding 3（Medium）· `personal_only` 被误添加 · 后端 + 前端双校验

| 层 | 改动 |
|---|---|
| 后端 [`app/api/admin/workflow-scope-order/route.ts`](../../app/api/admin/workflow-scope-order/route.ts) POST | select 加 `visible_to`，遇到 `personal_only` 返回 400 + 名单 + "请先改可见范围" 引导 |
| 前端 [`app/admin/workflow-config/page.tsx`](../../app/admin/workflow-config/page.tsx) AddWorkflowModal | filter 掉 `visible_to==='personal_only'`，底栏小字注明"已隐藏 N 个个人工作流" |

服务端兜底防绕过（直接 curl POST 也拒）。

### Finding 4（Medium）· POST / DELETE 没事务 · 新建 v47 + 改 route 调 RPC

**新建 [`supabase/migration_v47_workflow_scope_order_rpc.sql`](../../supabase/migration_v47_workflow_scope_order_rpc.sql)**：

- `add_workflow_scope_order(scope_type, scope_id, workflow_ids[])`
  - PL/pgSQL CTE 单事务：先算 next sort_order，再 `INSERT ... NOT EXISTS` 写 order，CTE 接 `INSERT ... ON CONFLICT DO NOTHING` 写 permissions
  - 返回 INT = 实际新增 order 行数（route 层 skipped = 总数 - 实际新增）
- `remove_workflow_scope_order(scope_type, scope_id, workflow_id)`
  - PL/pgSQL 单事务删两张表，幂等无副作用

**改 [`app/api/admin/workflow-scope-order/route.ts`](../../app/api/admin/workflow-scope-order/route.ts)**：

| 方法 | 之前 | 之后 |
|---|---|---|
| POST | route 层先 MAX sort_order → NOT IN 算 toAdd → INSERT order → SELECT 已存 perms → INSERT perms（4 步、可能半成功） | `db.rpc("add_workflow_scope_order", {...})` 一调到底 |
| DELETE | 2 次独立 `.delete()` | `db.rpc("remove_workflow_scope_order", {...})` 单调用 |

PUT 保持现状（之前已用 `batch_reorder_workflow_scope`）。

**MIGRATIONS.md 加 v47 条目**。

### R1.2 改动文件汇总

| 类型 | 文件 |
|---|---|
| 新建 | `supabase/migration_v47_workflow_scope_order_rpc.sql`（v46 之后跑） |
| 改 | `supabase/MIGRATIONS.md`（加 v47） |
| 改 | `lib/workflow-visibility.ts`（步骤 5 拆 5a/5b · Finding 1） |
| 改 | `app/api/workflows/route.ts`（去 limit · Finding 2） |
| 改 | `app/api/admin/workflow-scope-order/route.ts`（POST personal_only 校验 · POST/DELETE 改调 RPC · Finding 3+4） |
| 改 | `app/admin/workflow-config/page.tsx`（弹窗隐藏 personal_only + 底栏提示 · Finding 3） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.2 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（无新增 warning）

### R1.2 上线步骤增量

在原 v46 之后追加：
4. 在 Supabase Dashboard > SQL Editor 跑 [`supabase/migration_v47_workflow_scope_order_rpc.sql`](../../supabase/migration_v47_workflow_scope_order_rpc.sql)
5. [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md) v47 ☐ → ✅ + 跑过日期

### R1.2 新增验收（叠在原 15 项之上）

16. 实测前先验证：dev DB 存在至少 1 个 `visible_to='org_only'` 且 `resource_permissions` 里**无任何 workflow 记录**的工作流（未配过分层级）→ 切换组织用户仍能看到（Finding 1 兜底生效）
17. 启用工作流数量 > 500 时（或临时把 `.limit(500)` 拼回来对照），层级 scope 排序靠前但全局靠后的工作流能出现（Finding 2 修复确认）
18. AddWorkflowModal 列表不出现 `personal_only` 工作流；底栏显示"已隐藏 N 个"（Finding 3 前端）
19. 直接 curl POST `/api/admin/workflow-scope-order` 加 `personal_only` 工作流 → 400 + 错误名单（Finding 3 后端）
20. 配置页连续添加 → 中途 supabase 强制断网或制造冲突 → 不会留下"有 order 无 permissions"或反向半成功（Finding 4 RPC 事务）

---

## R1.3 增量 · 小B R1.2 评审 2 finding 修复（2026-06-03 当天）

### Finding 1（Medium）· 弹窗 pageSize 上限静默截断 · 修法 D · 专用轻量端点

**根因**：[`app/admin/workflow-config/page.tsx`](../../app/admin/workflow-config/page.tsx) AddWorkflowModal 调 `/api/admin/workflows?pageSize=200`，但 [`lib/config.ts:33`](../../lib/config.ts#L33) `PAGINATION.MAX_PAGE_SIZE=100` 在 [`lib/api-error.ts:51`](../../lib/api-error.ts#L51) `parsePagination` 内被 `Math.min` 截断到 100。工作流总量 > 100 时其余工作流无法被分配到层级，是 dead UI。

**修法**：新建 [`app/api/admin/workflows-compact/route.ts`](../../app/api/admin/workflows-compact/route.ts)：
- 仅返回弹窗渲染所需最小字段：`{id, name, description, enabled, visible_to}`（不带 steps / categories / permissions 副表）
- 不走 `parsePagination`，服务端硬上限 5000（远超现实业务规模，纯防失控）
- 同 `isWorkflowConfigAdmin` 权限闸门
- 响应 `{data, truncated, hardCap}`：到上限时 `truncated=true`

**前端**：
- [`app/admin/workflow-config/page.tsx`](../../app/admin/workflow-config/page.tsx) AddWorkflowModal 改调 `/api/admin/workflows-compact`
- 弹窗底栏 truncated 时显示 amber 提示「工作流总数达上限 · 已截断 · 请联系平台处理」

### Finding 2（Medium）· PUT 没校验 orderedIds 合法性 · 修法 · 集合相等强校验

**根因**：[`app/api/admin/workflow-scope-order/route.ts`](../../app/api/admin/workflow-scope-order/route.ts) PUT 仅校验 `scope_type/scope_id`，把 orderedIds 直接交给 `batch_reorder_workflow_scope`。该 RPC 只重写 `workflow_scope_order` 不写 `resource_permissions`，导致直接 curl 塞进"不在当前 scope 但 workflow 存在"的 id 就能制造"排序表里有、权限表里没有"状态。

**修法**：PUT 严格化为"仅承担重排"职责：
- 先 SELECT 当前 scope 的 `workflow_scope_order` 集合 `currentSet`
- 比对 `incomingSet`（orderedIds 去重后）：
  - 重复 id → 400 `orderedIds 含重复工作流 id`
  - 长度不等 → 400 提示"新增请用 POST，移除请用 DELETE"
  - 长度等但元素不等（multi/missing）→ 400 同上提示，列出 extra/missing 数量
- 集合相等才进入 RPC

设计原则：POST 管"加 + 写双表"，DELETE 管"删 + 删双表"，PUT 只管"已有集合的顺序调整"——三者职责清晰，攻击面收敛。

### R1.3 改动文件汇总

| 类型 | 文件 |
|---|---|
| 新建 | `app/api/admin/workflows-compact/route.ts`（弹窗专用轻量端点） |
| 改 | `app/admin/workflow-config/page.tsx`（AddWorkflowModal 改调 compact + truncated 提示） |
| 改 | `app/api/admin/workflow-scope-order/route.ts` PUT（orderedIds 集合相等强校验） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.3 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（仅遗留无关 `app/agents/[id]/page.tsx:778` warning）

### R1.3 无新 SQL

本轮仅 API + 前端改动，**不新增 migration**。v46 + v47 仍是 6.3up 配置功能的全部 DB 依赖。

### R1.3 新增验收（叠在原 20 项之上）

21. dev DB 临时插 ≥ 110 个 enabled 工作流 → 配置页 AddWorkflowModal 列表能展示全部（不再被截断到 100）
22. 直接 curl `PUT /api/admin/workflow-scope-order` 传入「比当前 scope 已配置工作流多 / 少 / 含未配置 id」三种 orderedIds → 全部 400 + 明确错误信息（提示用 POST/DELETE）
23. 配置页正常拖拽排序仍能成功（happy path：orderedIds 与当前集合完全相等只差顺序）
24. supabase 直接 SELECT：通过 R1.3 修复后 `workflow_scope_order` 与 `resource_permissions` 中 `(scope_type, scope_id, workflow_id)` 始终一一对应，无单边孤儿行

---

## R1.4 增量 · 小B R1.3 评审 1 finding 修复（2026-06-03 当天）

### Finding 1（Low）· POST 没拦 workflowIds 重复 · 修法 · route 层去重校验

**根因**：[`app/api/admin/workflow-scope-order/route.ts`](../../app/api/admin/workflow-scope-order/route.ts) POST 只校验"数组非空"，没像 PUT 那样去重。v47 RPC 内 [`add_workflow_scope_order`](../../supabase/migration_v47_workflow_scope_order_rpc.sql) 的 `INSERT ... SELECT FROM unnest(p_workflow_ids) WITH ORDINALITY` 没 `DISTINCT`，遇到 `[A, A]` 时两行都通过 `NOT EXISTS`（同一 SELECT 看不到本事务已 INSERT 的 A），随后撞 `workflow_scope_order` 主键 → 整个事务回滚 + 500。UI 用 Set 不会触发，但 curl / 集成测试 / SDK 调用留了口子。

**修法**：route 层 POST 入口做去重严格校验（与 PUT 同口径，4 行）：

```ts
if (new Set(workflowIds).size !== workflowIds.length) {
  return apiError("workflowIds 含重复工作流 id", "VALIDATION_ERROR");
}
```

**RPC 不动**（v47 不需要 v48 升级）：route 层去重后，RPC 拿到的就是无重复输入；正常输入下 RPC 工作正确，没有再升级的必要。

### R1.4 改动文件汇总

| 类型 | 文件 |
|---|---|
| 改 | `app/api/admin/workflow-scope-order/route.ts` POST（入口加去重校验） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.4 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（仅遗留无关 `app/agents/[id]/page.tsx:778` warning）

### R1.4 无新 SQL

仍是 v46 + v47 两条 migration。

### R1.4 新增验收（叠在原 24 项之上）

25. 直接 curl `POST /api/admin/workflow-scope-order` 传 `workflowIds: ["A", "A"]` → 400 + `workflowIds 含重复工作流 id`（不再 500）

---

## R1.5 增量 · 用户实测 dev 发现的浏览器缓存补丁（2026-06-03 当天）

### Bug · 改用户 dept/team 后 F5 软刷新仍看旧排序

**用户实测路径**：管理员把用户 A 从"小组 A"移除（admin/users PATCH `action=set-dept`）→ 用户 A 在浏览器 F5 软刷新 → 仍看到"小组 A"的旧排序，必须 Ctrl+Shift+R 硬刷或重新登录才能看到回退后的组织排序。

**根因分析**：
- 后端 `/api/workflows` 已声明 `dynamic = "force-dynamic"`（服务端不缓存），DB 层永远是对的
- RPC `get_user_workflow_order` 内部实时 SELECT users.team_id，set-dept 落库即生效
- **但前端 [`app/page.tsx:220`](../../app/page.tsx) `fetch("/api/workflows")` 没标 `cache: "no-store"`，且服务端响应也没回 `Cache-Control: no-store` 头**
- 浏览器按 HTTP 启发式缓存返回旧响应 → F5 触发组件重 mount 重新 fetch，但浏览器层 cache hit 返回旧数据
- Ctrl+Shift+R 绕过 HTTP 缓存 → 拿到新数据 ✓
- 重新登录 → cookie 重签 + tree 重建 → 浏览器把它当新请求 ✓

**为什么 set-dept 不像 set-tenant 那样写 `force_relogin_at`**：
- 换组织（[`app/api/admin/users/[id]/route.ts:111`](../../app/api/admin/users/%5Bid%5D/route.ts) RPC `change_user_tenant`）会写 `force_relogin_at` → 立刻踢下线（5.6up 设计）
- 因为 `tenant_code` 在 JWT 里且权限范围跨度大，必须强制重登
- `dept_id`/`team_id` 不在 JWT 里、且仅影响展示，不强制重登是合理的；但漏掉了"浏览器缓存"这条尾巴

### 修法 · 方案 C 双层 no-store

**后端** · [`app/api/workflows/route.ts`](../../app/api/workflows/route.ts) 4 个返回点统一加 `Cache-Control: no-store, max-age=0`：

```ts
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;
// 401 / 空 ids / DB error / 主体返回 全部 { headers: NO_STORE_HEADERS }
```

**前端** · [`app/page.tsx:220`](../../app/page.tsx) fetch 显式标 no-store：

```ts
fetch("/api/workflows", { cache: "no-store" })
```

双层兜底：前端表达意图，后端覆盖所有调用方（防其他页面/SDK 踩同样坑）。

### R1.5 改动文件汇总

| 类型 | 文件 |
|---|---|
| 改 | `app/api/workflows/route.ts`（NO_STORE_HEADERS 常量 + 4 个返回点附 headers） |
| 改 | `app/page.tsx`（fetch /api/workflows 加 `{ cache: "no-store" }`） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.5 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（仅遗留无关 `app/agents/[id]/page.tsx:778` warning）

### R1.5 无新 SQL

仍是 v46 + v47。

### R1.5 新增验收（叠在原 25 项之上）

26. 管理员在 admin/users 把用户 A 从"小组 A"移除 → 用户 A 端 **F5 软刷新**（不是 Ctrl+Shift+R）→ 工作流排序立即回退到组织层级 / 全局兜底，不再要求重登
27. 浏览器 DevTools Network 面板观察 `/api/workflows` 响应：Response Headers 含 `Cache-Control: no-store, max-age=0`；Request 重发时 Status 仍是 200（不是 304 from cache）

---

## R1.6 增量 · 用户实测 dev 提的 UI 三项改进（2026-06-03 当天）

### 问题 1 · 缺返回入口

**修法**：[`app/admin/workflow-config/page.tsx`](../../app/admin/workflow-config/page.tsx) PageHeader actions 加 `<ArrowLeft />` outline 按钮 → `router.push("/admin/workflows")`。与"分层级配置"按钮（工作流管理头部）形成往返闭环。

### 问题 2 · 组织/部门/小组 / 已配置工作流过多时撑爆页面

**修法**：4 个 Card 内容列表区域统一加 `max-h + overflow-y-auto + pr-1`：
- 左侧 3 个小窗（组织 / 部门 / 小组）：`max-h-[280px]`
- 右侧已配置工作流：`max-h-[560px]`

超过高度自动出现纵向滚动条；右侧 `pr-1` 给滚动条留 padding，避免覆盖按钮 hit area。

### 问题 3 · 缺搜索功能

**修法**：新增 `MiniSearch` 子组件（紧凑型 h-7 + 内嵌 X 清空按钮），4 个小窗都嵌入：

| 小窗 | 搜索字段 | 触发条件 |
|---|---|---|
| 组织 | name + code | 始终显示 |
| 部门 | name | 始终显示 |
| 小组 | name | 始终显示 |
| 已配置工作流 | name + description | 仅在 items > 5 时显示（避免少量数据冗余 UI） |

**右侧搜索的细节**：搜索过滤期间禁用拖拽 —— 拖完会 PUT orderedIds，但 R1.3 Finding 2 要求 orderedIds 是当前 scope 完整集合，搜索过滤后 visible 列表不是完整集合，必然 400。所以：
- `draggable={!isSearching}` + cursor 切回 default
- 搜索框下方 amber 提示「搜索过滤期间已禁用拖拽，清空搜索框可恢复」
- 移除按钮 X 不受影响（DELETE 一次只动一个，不涉及 orderedIds）

每个 Card 标题右侧加 `共 N` 计数（轻量信息，不抢眼）。

### R1.6 改动文件汇总

| 类型 | 文件 |
|---|---|
| 改 | `app/admin/workflow-config/page.tsx`（PageHeader actions + 4 搜索 state + 4 小窗 max-h + 拖拽闸门 + MiniSearch 子组件） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.6 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（仅遗留无关 `app/agents/[id]/page.tsx:778` warning）

### R1.6 无新 SQL / 无后端改动

仅前端样式 + 交互。

### R1.6 新增验收（叠在原 27 项之上）

28. 配置页头部「返回」按钮能跳回 `/admin/workflows`
29. 任一小窗内容超过 280px / 560px 时出现内部纵向滚动条，不撑爆页面
30. 4 个小窗顶部搜索框都能按关键词过滤（含清空 X 按钮）；空匹配时显示"无匹配 XX"
31. 在已配置工作流搜索框输入字符 → 列表过滤 + 拖拽手柄变灰 cursor 切 default + 显示 amber 警告条；清空搜索 → 拖拽恢复
32. 已配置工作流 ≤ 5 个时不显示搜索框（避免冗余）；> 5 个时出现搜索框

---

## R1.7 增量 · 工作流管理分类折叠（与智能体管理同风格）

### 用户需求

[`app/admin/workflows/page.tsx`](../../app/admin/workflows/page.tsx) 当前按工作流分类分区展示，header 是静态 div，下面工作流卡片始终平铺。智能体管理页 [`app/admin/agents/page.tsx`](../../app/admin/agents/page.tsx) 5.16up/6.3up 已经做了 chevron 折叠风格（默认折叠 + 点击展开），用户要求工作流管理对齐。

### 修法 · 移植智能体管理同款机制

1. 新增 state：`expandedWfSections: Set<string>` + `toggleWfSection(id)` helper（与 [`agents/page.tsx:162`](../../app/admin/agents/page.tsx) 同结构）
2. 原 section header 静态 div 改成全宽 button：
   - 整段可点击（`w-full` button + `cursor-pointer`）
   - 左侧 chevron 18px（`ChevronDown` / `ChevronRight` 切换）
   - 分类 icon 24x24 圆角 + 兜底 `Tag` 14px icon 蓝色背景
   - 标题 16px font-semibold（原 13px → 16px 提级，与智能体管理同字号）
   - 计数 12px text-gray-400
   - 背景 `bg-gray-50/80 hover:bg-gray-100/80` 区分于普通 hover
3. 工作流卡片列表加 `{sectionExpanded && (...)}` 条件渲染
4. `groupedWfSections.map((section) => (...))` 改成 `((section) => { const sectionExpanded = ...; return (...); })` 以读取折叠状态

### 默认行为

默认全折叠（`Set<string>` 初始为空），与智能体管理一致。首次进入页面看到所有分类 header，点击展开看到下面的工作流。

### R1.7 改动文件汇总

| 类型 | 文件 |
|---|---|
| 改 | `app/admin/workflows/page.tsx`（state + toggle + header + conditional render） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.7 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（仅遗留无关 `app/agents/[id]/page.tsx:778` warning）

### R1.7 无新 SQL / 无后端改动

仅前端样式 + 折叠状态。

### R1.7 新增验收（叠在原 32 项之上）

33. 进入工作流管理 → 看到所有分类 section header（含 chevron + icon + 名称 + 计数），下面默认折叠
34. 点击某分类 header → 该 section 展开，显示该分类下所有工作流；再点击折叠
35. 多个 section 可以同时独立展开/折叠（state 是 Set 不是 single id）
36. 折叠状态下点击「新增工作流」「按某分类筛选」等操作不受影响
37. 工作流卡片自身的展开（查看步骤）与 section 折叠是两层独立机制 —— 互不冲突

### R1.7 微调 · 分类 header 卡片化

用户反馈"灰底块不够清晰"。改动：
- `bg-gray-50/80` → `card card-hover`（白底 + border + shadow + hover 阴影加深，复用 globals.css 既有类）
- padding `px-3 py-3` → `px-5 py-4`（与下面工作流卡片同口径）
- icon 24→28px 圆角 8（卡片化后视觉占比合适）
- 计数 `ml-auto` 右对齐 + 文案 "2 个" → "2 个工作流"

整体视觉：分类 header 与工作流卡片同等级别的"卡片"，但 chevron + 标题字号 + ml-auto 计数让它一眼能识别成"分组标题"而不是"内容卡片"。

---

## R1.8 增量 · 删除工作流"排序"输入框（接管为「分层级配置」+ 自动接末尾）

### 用户需求

工作流编辑表单里有「排序（数字越小越靠前）」输入框，但 6.3up 已经给了「分层级配置」按 scope 排序，全局排序已不必手填。用户要求删掉这个输入框。

### 决策 · DB 字段保留 · 仅删 UI + POST 自动接末尾

| 字段 / 接口 | 处理 | 理由 |
|---|---|---|
| DB `workflows.sort_order` | **保留** | 仍是未配层级工作流的全局兜底键（前台 `/api/workflows` 最终排序 `COALESCE(scope_order, workflows.sort_order, 999999)`）+ 后台列表默认排序键 |
| 表单 UI 输入框 | **删** | 用户用「分层级配置」管显式排序 |
| `EMPTY_WF.sortOrder` / 编辑回填 / 提交传值 | **删** | 表单字段去掉 |
| POST `/api/admin/workflows` 接受 `sortOrder` | **保留接口；不传时自动 max+1 接末尾** | 显式传仍优先（集成测试 / SDK / 后续工具）；不传不再默认 0 堆首位 |
| PATCH `/api/admin/workflows/[id]` 接受 `sortOrder` | **保留** | 向后兼容，留后门给未来批量调序工具 |
| 复制路由照搬源 `sort_order` | **不动** | 副本与源同序列，不冲突 |

### 改动文件

| 类型 | 文件 | 改动 |
|---|---|---|
| 改 | `app/admin/workflows/page.tsx` | `EMPTY_WF.sortOrder` 删；`openEditWf` 回填删 `sortOrder`；`handleSaveWf` body 删 `sortOrder`；Input "排序（数字越小越靠前）" 删（line 1137） |
| 改 | `app/api/admin/workflows/route.ts` | POST `sort_order` 从 `sortOrder ?? 0` 改成"未传则 SELECT max + 1 自动接末尾"逻辑（line 161 附近） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md` | 本节 |

### R1.8 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（无新增 warning）

### R1.8 无新 SQL / 不动 DB 字段

仍是 v46 + v47。`workflows.sort_order` 字段维持不变。

### R1.8 新增验收（叠在原 37 项之上）

38. 工作流编辑弹窗不再显示"排序（数字越小越靠前）"输入框
39. 新建工作流（不传 sortOrder）→ supabase 查 `workflows` 表 → 新行的 `sort_order` = 当前最大 sort_order + 1，不再堆 0
40. 直接 curl POST `/api/admin/workflows` 传 `{name:"X", sortOrder:5}` → 仍按 5 入库（兼容显式调用）
41. 已有工作流编辑保存 → DB 中 `sort_order` 保持原值不变（前端不再 PATCH 该字段）
42. 配置「分层级配置」+ 普通工作流混合存在的前台用户工作流列表 → 已配置层级的工作流仍按 scope 排序优先，未配置的按 `workflows.sort_order` 兜底（验证 DB 字段仍生效）

---

## R1.9 增量 · 修复"可见权限 ≠ 分层级配置"UX 缝隙（DB trigger 反向同步）

### 用户实测发现的 Bug

用户在工作流编辑器选「可见权限 = 指定组织可见 → DEMO」保存，然后去「分层级配置」选 DEMO scope 找不到这个工作流。

### 根因

| 路径 | 写 `resource_permissions` | 写 `workflow_scope_order` |
|---|---|---|
| 工作流编辑器（[`/api/admin/workflows`](../../app/api/admin/workflows/route.ts) POST/PATCH） | ✓ | ❌ 漏 |
| 分层级配置页（[`/api/admin/workflow-scope-order`](../../app/api/admin/workflow-scope-order/route.ts) POST RPC） | ✓ | ✓ |

两条路径对同一份"P1 一体语义"数据没有同步 —— 编辑器只管"谁能看"，配置页同时管"谁能看 + 顺序"。

### 修法 · 新建 v48 · DB trigger 反向同步 + 一次性 backfill

**新建** [`supabase/migration_v48_perms_to_scope_order_trigger.sql`](../../supabase/migration_v48_perms_to_scope_order_trigger.sql)：

1. **trigger function** `sync_workflow_scope_order_from_perms()`：
   - `AFTER INSERT ON resource_permissions` + `resource_type='workflow'` + `scope_type ∈ org/dept/team` → 自动 INSERT 一行 `workflow_scope_order`，`sort_order = MAX + 1` 接末尾；`ON CONFLICT DO NOTHING` 防止与 v47 RPC 冲突
   - `AFTER DELETE` → 精确匹配删除对应 order 行
2. **一次性 backfill**：把现有 perms 中存在但 order 中缺失的工作流补齐 order 行（`ROW_NUMBER() OVER (PARTITION BY ...)` + `base_order + (rn - 1)` 接末尾），确保 trigger 生效前历史数据也一致
3. **与 v47 RPC 协作（无副作用）**：
   - `add_workflow_scope_order` 内 CTE 先写 order 后写 perms → trigger 反向 INSERT 主键已存在 → ON CONFLICT 跳过 ✓
   - `remove_workflow_scope_order` 先 DELETE order 后 DELETE perms → trigger 反向 DELETE 已为 0 行 → 无影响 ✓

**覆盖面**：trigger 自动收口所有反向同步路径：
- ✓ 工作流编辑器写 visible_to / permissions
- ✓ admin/resource-permissions POST/DELETE
- ✓ 直接 curl / SDK / 后续任何新写入路径

无需改任何 API route 代码 —— DB 层统一兜底。

### R1.9 改动文件汇总

| 类型 | 文件 |
|---|---|
| 新建 | `supabase/migration_v48_perms_to_scope_order_trigger.sql`（trigger function + trigger + backfill） |
| 改 | `supabase/MIGRATIONS.md`（加 v48 条目） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.9 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓

### R1.9 上线步骤增量

原 v46 + v47 之后追加：
6. 在 Supabase Dashboard > SQL Editor 跑 [`supabase/migration_v48_perms_to_scope_order_trigger.sql`](../../supabase/migration_v48_perms_to_scope_order_trigger.sql)
7. [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md) v48 ☐ → ✅ + 跑过日期

### R1.9 新增验收（叠在原 42 项之上）

43. 跑 v48 后：用户实测路径 —— 工作流编辑器选「可见权限 = 指定组织可见 → DEMO」保存 → 进「分层级配置」选 DEMO scope → **应能看到该工作流**（trigger 已自动同步）
44. supabase 跑诊断 SQL（v48 文件末尾验证 #2）→ 返回 0 行（无 perm 而无 order 的孤儿数据）
45. 直接 curl `POST /api/admin/resource-permissions` 加一条 workflow + org=DEMO 的 perm → `workflow_scope_order` 自动多一条对应行；反向 DELETE 同样
46. `dept` / `team` scope perm 同样触发 trigger（不仅 org）；`user` / `user_type` / `all` / `group` scope 不触发（trigger 内 IF 过滤）
47. 跑 v48 backfill 之前已有的"perm 存在 + order 缺失"工作流，跑完后自动补齐 order 行（一次性）

---

## R1.10 增量 · 修 workflows.created_by FK 23503（用户实测发现）

### Bug · 新建工作流报"关联数据不存在"

用户在编辑器填完名称 / 简介 / 标签 / 可见权限「我所在组织全员可见」/ 启用 → 点「创建」→ 红色提示「关联数据不存在」。

### 根因 · 与 v28 修 audit_logs.admin_id 同款 FK 不一致 bug

[`supabase/migration_v31.sql:8`](../../supabase/migration_v31.sql) 把 `workflows.created_by` 定义为 `UUID REFERENCES admins(id) ON DELETE SET NULL`。

但 admin JWT 的 `adminId` 有两种来源（[`lib/session.ts getActiveAdmin`](../../lib/session.ts)）：
- 内置管理员 → `admin.adminId = admins.id` → FK 通过
- **普通用户被提升为管理员**（用户当前路径）→ `admin.adminId = users.id` → admins 表没这 id → INSERT 时 FK 23503 → `lib/api-error.ts` 走 `"关联数据不存在"` 分支

v28 已经因为同款问题移除了 `audit_logs.admin_id` FK，但 v31 引入 `workflows.created_by` FK 时**没汲取教训**。

### 修法 · 新建 v49 drop FK

**新建** [`supabase/migration_v49_workflows_created_by_drop_fk.sql`](../../supabase/migration_v49_workflows_created_by_drop_fk.sql)：

```sql
-- DO BLOCK 兜底任意约束名（v31 用 ALTER TABLE ADD COLUMN ... REFERENCES，约束名 PG 自动生成）
DO $$
DECLARE v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'workflows' AND att.attname = 'created_by' AND con.contype = 'f'
  LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE workflows DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;
```

`created_by` 字段本身**保留**（仍记录创建者 id 供审计追溯）；业务层（[`lib/admin-permissions.ts`](../../lib/admin-permissions.ts) `canActOnRole`）只看 `created_by_role` 字段判定上下级权限，不依赖 FK 完整性。

无需改任何 API route 或前端代码 —— DB 层一刀切。

### R1.10 改动文件汇总

| 类型 | 文件 |
|---|---|
| 新建 | `supabase/migration_v49_workflows_created_by_drop_fk.sql` |
| 改 | `supabase/MIGRATIONS.md`（加 v49 条目） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.10 CI

无代码改动，CI 已通过 R1.9 验证。

### R1.10 上线步骤增量

在原 v46 + v47 + v48 之后追加：
8. 在 Supabase Dashboard > SQL Editor 跑 [`supabase/migration_v49_workflows_created_by_drop_fk.sql`](../../supabase/migration_v49_workflows_created_by_drop_fk.sql)
9. [`supabase/MIGRATIONS.md`](../../supabase/MIGRATIONS.md) v49 ☐ → ✅ + 跑过日期

### R1.10 新增验收（叠在原 47 项之上）

48. 跑 v49 后：非内置 admin（从 users 表提升的）创建工作流 → 成功，不再报「关联数据不存在」
49. 验证 SQL（v49 文件末尾验证 #1）返回 0 行 → FK 确实已 drop
50. 内置 admin 创建工作流仍正常（兼容）；已创建工作流的 `created_by` 字段保留原值（不动数据）

---

## R1.11 增量 · org_admin 后台工作流列表叠加 visible_to='all'

### 用户需求

R1.x 设计里 `org_admin` 在 `/admin/workflows` 只看到 `resource_permissions` 命中本组织 / 部门 / 小组的工作流。用户要求叠加 `visible_to='all'` 的全平台可见工作流也展示，让 org_admin 能"看见"超管发布的全平台工作流（编辑权由 `canActOnRole` 自然把关，看不到不等于看不见）。

### 修法

[`app/api/admin/workflows/route.ts`](../../app/api/admin/workflows/route.ts) GET org_admin 分支并行多拉一次 `visible_to='all'` 集，并集去重作为 `scopedWfIds`：

```ts
const [{ data: scoped }, { data: allVis }] = await Promise.all([
  db.from("resource_permissions").select("resource_id").eq("resource_type","workflow").or(orFilters.join(",")),
  db.from("workflows").select("id").eq("visible_to","all"),
]);
scopedWfIds = Array.from(new Set([...permIds, ...allVisIds]));
```

写操作权限不动 —— [`lib/admin-permissions.ts canActOnRole`](../../lib/admin-permissions.ts) 仍按 `created_by_role` 把关：
- 全平台工作流（多为 super/system 创建）→ org_admin 编辑/删除按钮自动置灰 + tooltip 说明原因
- 复制按钮所有人都能用（决策 2=A）
- 本组织 perms 命中的工作流仍按原 RBAC（org_admin 可改自己组织建的）

### R1.11 改动文件汇总

| 类型 | 文件 |
|---|---|
| 改 | `app/api/admin/workflows/route.ts`（org_admin 分支叠加 `visible_to='all'` 查询） |
| 改 | `upgrade/6.3up/变更记录-20260603-workflow-scope.md`（本节） |

### R1.11 CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（无新增 warning）

### R1.11 无新 SQL

仅 API 改动。

### R1.11 新增验收（叠在原 50 项之上）

51. org_admin 登录 `/admin/workflows` → 列表包含：本组织相关 perms 命中工作流 **+** 所有 `visible_to='all'` 工作流
52. 全平台工作流在 org_admin 视角下：编辑/删除按钮置灰 + tooltip "由 XX 创建，无权修改"；复制按钮可用
53. 本组织 org_admin 创建的工作流：可编辑/删除（原 RBAC 不变）
54. 计数「共 N 个」反映并集去重后的总数（不重复计数同 id）
