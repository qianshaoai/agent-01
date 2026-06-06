# 6.4up · 权限管理 v2 · Phase B · 变更记录

**日期** 2026-06-06
**分支** feature/6.4up（commit `678894e` Phase A R1 之上）
**方案** [`方案-权限管理v2-PhaseB-R0-20260606.md`](./方案-权限管理v2-PhaseB-R0-20260606.md)
**审批** 小B 审 R0 通过 + 用户拍板（D1-D5 + Tsx + GO）+ 4 条硬约束

---

## 主题

`/admin/permissions` 改 **4 Tab** 容器；新建 4 个 super-only API + 5 个前端组件；tsx 进 devDependency + 跨平台 seed:check。

**性质**：纯前端 + 新 API；不动 hasPermission / enforce flag / 6.4up 行为合约。enforce 未启时本期写入"安静坐着"，等 Phase C-E 启动 enforce 才生效。

---

## 1. C1 · tsx 工具链固化（小B Phase A R1 末尾建议）

- [`package.json`](../../package.json) `devDependencies` 加 `"tsx": "^4.20.6"`；
  scripts 加 `seed:gen` 和 `seed:check`
- 新建 [`scripts/check-permission-seed.ts`](../../scripts/check-permission-seed.ts)：
  - 用 Node API 跑 `generate-permission-seed.ts` + 读 v52 + 提取 INSERT 段 + 行级 diff
  - 跨平台（Windows PowerShell / *nix bash 都跑）
  - 不依赖 bash 进程替换 `<(...)`（C4 硬约束）
  - 退出码 0 = 一致；1 = 不一致并打印前 10 条差异

**验证**：`npm run seed:check` 输出 `[seed-check] OK ...`。

---

## 2. C2 · 4 个新 super-only API

所有 API 服务端强制 `admin.role === "super_admin"`，否则 403（C1 硬约束）。

### B.1 · `GET /api/admin/builtin-admins` —— [route.ts](../../app/api/admin/builtin-admins/route.ts)

返回所有 builtin admin（admins 表全集 ∪ `users WHERE role∈{super,system,org} AND status='active'`），每条含：

```ts
{ id, source, username, role, tenantCode, overrideCount }
```

- 一次性 select + 客户端聚合 overrideCount（R5：不在 list 算 effective set）
- 按 role 优先级 + username 升序

### B.2 · `GET /api/admin/admin-effective/[adminId]?source=...` —— [route.ts](../../app/api/admin/admin-effective/%5BadminId%5D/route.ts)

返回单 admin 的 `{ role, defaultPackKeys, overrides, effective, superAdmin }`。

- super_admin → `effective: ["*"]` 哨兵 + `superAdmin: true`，前端显示"硬全权"提示禁用编辑
- 非 super → 默认包 + grant/revoke override 合成 effective

### B.3 · `GET/PUT /api/admin/role-permissions/[role]` —— [route.ts](../../app/api/admin/role-permissions/%5Brole%5D/route.ts)

`role` 严校 `∈ {'system_admin','org_admin'}`，其它值 400（C1 硬约束）。

**GET**：拉默认包 + 同时算 `beforeHash` + `affectedCount`（减少前端 round-trip）。

**PUT** 完整实施 C2 + C3 硬约束：

1. body 解析 + 双护栏字段强校
   - `confirmAffectedCount: number`
   - `confirmBeforeHash: string`（64 位 sha256 hex）
2. 读 before keys（SELECT WHERE role=:role）
3. 服务端独立重算 beforeHash 与 actualCount，任一不等 → **412 PRECONDITION_FAILED**（C3 双条件）
4. 算 diff（toAdd / toRemove）
5. UPSERT toAdd（onConflict 跳过）
6. DELETE toRemove
7. **读后校验**：再 SELECT 与期望 sorted 数组 strict equal
8. 校验失败 → **不写 audit**，500（C2 硬约束）
9. 校验通过 → 写 audit detail 含 `before/after/added/removed/affectedCount`

业务约束：写入 keys 严校 `isAdminPermissionKey`；拒 `setting.*` / `permission.*` 前缀（与 admin-overrides POST 同口径）。

### B.4 · `GET /api/admin/permission-audit` —— [route.ts](../../app/api/admin/permission-audit/route.ts)

拉 `audit_logs WHERE resource_type IN ('builtin_role_permission','admin_override','custom_role')`，
支持 `resourceType / adminId / dateFrom / dateTo / page / pageSize` 过滤。

**不复用** `audit-logs` 路由的 org_admin 可见策略 —— 本 API 仅 super_admin（C1 硬约束）。

### 同时改 [`lib/api-error.ts`](../../lib/api-error.ts)

`ErrorCode` 加 `PRECONDITION_FAILED` → 412 status；供 B.3 PUT 双护栏使用。

---

## 3. C3 · UI 共用矩阵 + 4 Tab 组件

### `components/permissions/v2/permission-matrix.tsx`（新建）

按 resource 分块的 checkbox 网格（D4 拍板）；每块按 action 分行，每行按 scope（team < dept < org < all）排列。

四态 cell：
- `default`：默认包持有 → 蓝底（行内置色）
- `grant`：override 加持 → 绿底 + "G" 角标
- `revoke`：override 移除 → 红底 + "R" 角标
- `off`：未持有 → 白底空

`editable=true` 时点击 chip 触发 `onToggle(key, nextOn)`；Tab 1 / Tab 2 用同一组件，差异由 `resolveCellState` 与 `onToggle` 处理。

### `components/permissions/v2/tab-personal.tsx`（Tab 1）

左侧 admin 列表（含 overrideCount chip + 角色 chip + tenant_code）+ 右侧详情面板。

- 列表点击 → lazy load `/api/admin/admin-effective`（D1：列表不算 effective）
- 详情显示统计行（默认包/grant/revoke/最终生效 各 keys 数）
- 矩阵 editable，点击 chip 触发：
  - `default` → 点击关 = POST override (effect='revoke')
  - `off` → 点击开 = POST override (effect='grant')
  - `grant` → 点击关 = DELETE override
  - `revoke` → 点击开 = DELETE override
- super_admin 行：列表显示 Shield 图标；详情显示"硬全权"提示，矩阵不渲染（编辑禁用）
- 个人 override 不弹二次确认（D3 拍板）；操作完即 reload 列表 + 详情

### `components/permissions/v2/tab-templates.tsx`（Tab 2）

顶部 role 切换（system_admin / org_admin）+ 矩阵 editable（点击 chip 加/去）+ 底部 sticky 操作栏 + 二次确认 modal。

- diff 实时算（待加 / 待去）
- 切换 role 时如有未保存 diff → 浏览器原生 confirm 提示
- 保存按钮 → 弹二次确认 modal：
  - 显示 `影响 N 名 [role] 管理员` 警示
  - 显示 added/removed 列表（前 20 条 + "还有 X 项"溢出）
  - 提示"当前 enforce 留空 → 写入数据库不改路由行为"
  - 确认 → PUT with `confirmAffectedCount` + `confirmBeforeHash`
- 412 处理：toast 提示 + 关闭 modal + reload（拿到新 hash 与 count）
- 500 处理：toast 提示

### `components/permissions/v2/tab-custom-roles.tsx`（Tab 3）

**等价搬迁** 原 `app/admin/permissions/page.tsx` 内容（去 AdminLayout/PageHeader 外壳）；
RoleEditModal + RoleBindUsersModal + ModalShell 全部保留；
接口契约（`/api/admin/custom-roles` + `/api/admin/user-custom-roles`）**完全不变**，验收等价 6.4up 行为。

### `components/permissions/v2/tab-audit.tsx`（Tab 4）

只读列表 + filter（resourceType select + dateFrom/dateTo input + 刷新按钮）+ 行展开 detail JSON。
分页基于通用 paginatedResponse（pageSize=50）。

---

## 4. C4 · 4 Tab 容器 · [permissions/page.tsx](../../app/admin/permissions/page.tsx)

- 顶部 PageHeader 不变
- Tab Bar 横排（D5 顺序：个人 → 模板 → 自定义 → 审计）
- 选中 tab 由 `?tab=` URL 派生（useMemo），不存本地 state；浏览器后退 → tab 自动跟着变
- `setTabAndUrl` 只 router.replace URL，不 setState
- 页面级 super_admin guard：fetch `/api/admin/me`，非 super 跳 dashboard
- 顶部 useMemo 取 ADMIN_PERMISSION_KEYS 全集，传给 Tab 1/2 矩阵
- 用 `<Suspense>` 包裹内层组件（Next 16 `useSearchParams` 必须在 Suspense boundary 内）

---

## 5. 不动 / 边界

- v2 enforce flag 仍空（生产 / dev / staging 全部空 → 行为零变化）
- `hasPermission` 公式不动（Phase A R1 已就绪）
- v52 migration 不重发（F5 脚本 diff 证明等价）
- 6.4up custom_admin 通道完全独立（custom 不读 v52 两表）
- 现存 60+ admin 路由不动（未接入 requireAccess）
- 权限 V2 仍**不进 5/19 上线包**

---

## 6. CI 验收

| 项 | 结果 |
|---|---|
| `npm run ci:typecheck` | ✅ 0 errors |
| `npm run ci:lint` | ✅ 0 errors（仅历史 `agents/[id]/page.tsx:778` hook deps warning） |
| `npm run ci:build` | ✅ Compiled successfully · 56/56 pages |
| `npm run seed:check` | ✅ `[seed-check] OK · generate-permission-seed.ts 输出与 v52 INSERT 段一致` |

---

## 7. 手测验证（待小B 二审重点）

### 7.1 · 权限边界

- 非 super 访问 `/admin/permissions` 页面 → 跳 `/admin/dashboard`
- 非 super 直接 curl 4 个新 API → 403 `仅超级管理员可访问`
- super GET `/api/admin/role-permissions/foo` → 400（role 严校）
- super GET `/api/admin/role-permissions/super_admin` → 400（不允许）

### 7.2 · Tab 1 个人 override

- super 列表 → 选某 system_admin → 矩阵显示蓝色默认包 ≈109 keys
- 点击未持有的 cell（如 `provider.create.org`）→ 写 grant override → cell 变绿带 G 角标 → 列表 overrideCount +1
- 点击已持有的 default cell（如 `notice.delete.org`）→ 写 revoke override → cell 变红带 R 角标
- 点击已有 grant cell → DELETE override → cell 回到 off
- 点击已有 revoke cell → DELETE override → cell 回到 default
- 选 super_admin 行 → 显示"硬全权"提示，矩阵不渲染

### 7.3 · Tab 2 默认包 + 并发护栏

- super 编辑 org_admin 默认包 → 加 `provider.create.org` → 保存
- 二次确认 modal 显示"影响 N 名 [组织管理员]" + added/removed 列表
- 确认 → 200 OK，toast "已保存：新增 1 / 移除 0"
- DB 查 builtin_role_permissions WHERE role='org_admin' AND permission_key='provider.create.org' → 新增 1 行
- audit_logs WHERE resource_type='builtin_role_permission' → 新增 1 行 detail 含 before/after/added/removed
- **并发护栏 412**：开 2 个 super 窗口同时编辑 org_admin → 窗口 A 保存 → 窗口 B 保存 → 窗口 B 收到 412 "已被改动，请刷新"
- **数变化 412**：保存时手工 INSERT 一条 user role=org_admin → 提交 → 412 "受影响管理员数变化"
- **读后校验**：理论上正常路径不触发；如果触发说明 race condition / DB 一致性问题

### 7.4 · Tab 3 行为等价

- 列出现有 custom_roles
- 新建 / 编辑 / 删除 / 用户绑定 / 解除 全部 6.4up 等价
- API 仍是 `/api/admin/custom-roles` 与 `/api/admin/user-custom-roles`

### 7.5 · Tab 4 审计

- 列出 builtin_role_permission / admin_override / custom_role 三类
- 单类 filter 工作
- 日期范围 filter 工作
- 行展开显示 detail JSON

### 7.6 · enforce 零行为变化（关键）

- env `PERMISSION_V2_ENFORCE_RESOURCES=""` → 任何普通后台路由判定与 6.4up 等价
- Tab 1/2 改了一堆 override/默认包 → 不影响任何路由（hasPermission v2Loaded=false 一直走旧 fallback）

---

## 8. 文件清单

### 新建（10）

- `app/api/admin/builtin-admins/route.ts`
- `app/api/admin/admin-effective/[adminId]/route.ts`
- `app/api/admin/role-permissions/[role]/route.ts`
- `app/api/admin/permission-audit/route.ts`
- `components/permissions/v2/permission-matrix.tsx`
- `components/permissions/v2/tab-personal.tsx`
- `components/permissions/v2/tab-templates.tsx`
- `components/permissions/v2/tab-custom-roles.tsx`
- `components/permissions/v2/tab-audit.tsx`
- `scripts/check-permission-seed.ts`

### 修改（3）

- `app/admin/permissions/page.tsx`（4 Tab 容器；原内容搬到 tab-custom-roles）
- `package.json`（tsx devDep + 2 个 npm script）
- `lib/api-error.ts`（加 `PRECONDITION_FAILED` 412）

### 文档（2）

- `upgrade/6.4up/方案-权限管理v2-PhaseB-R0-20260606.md`（已含拍板 + 4 条硬约束补录）
- `upgrade/6.4up/变更记录-20260606-permission-v2-phase-b.md`（本文件）

---

## 9. 上线策略

- **无新 migration**（v52 不重发）
- 合并：Phase B 作为 `678894e` 之后的 follow-up commit 留 `feature/6.4up`
- **仍不进 5/19 上线包**（权限 V2 暂不上线）
- env `PERMISSION_V2_ENFORCE_RESOURCES` 生产保持空（C1 之上的承诺）

---

## 10. Phase C / D / E / F 入口（不变）

- Phase C（~4h）：notice / category / analytics / audit 路由接 requireAccess + env 设 `"notice,category"` 开 enforce 联调
- Phase D（~6h）：user / agent / agent_draft / workflow / tenant
- Phase E（~4h）：kb / provider / setting / permission + 联调 5.30up scoped-access
- Phase F（~4h）：admin-layout `requiredPermission` 字段 + 全仓 super_admin 二扫 + 废 canActOnRole

Phase B 完成 = UI 可视化运营基础就位；Phase C 启动条件已具备。

---

## 11. 已知非阻断

- dev server 跑在 webpack 模式（Next 16 + Turbopack 下 app router 的 API 路由 404，参修复 10 后备注）。本期 build 走 webpack 正常。
- `agents/[id]/page.tsx:778` 历史 hook deps warning（与 Phase B 无关）。
- `ci:test` 仍是占位输出（M2.2 in 4.17up 跟踪）。Phase F 时可把 `seed:check` 进 `ci:test`。
