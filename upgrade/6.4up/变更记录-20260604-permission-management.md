### 6.4up 变更记录 · 权限管理 · 自定义角色 + 模块化能力包

日期：2026-06-04
分支：`feature/6.4up`（从 `master2` 拉出）
依据：[方案-权限管理-20260604.md](./方案-权限管理-20260604.md)
位置：`upgrade/6.4up/`
版本：R1.2（小B R0 → R1.0 二审 → R1.2 决策 10 单列校验补强 · 可开工）

---

## 背景

用户原话：
> 我想做一个权限管理的功能，超级管理员可以设定其他所有管理员的后台权限；同时支持自定义角色，比如设置小组长，该小组长只能创建本组的工作流。

R0 → R1.2 评审收口（详见方案 § R0 → R1.2 评审摘要）：
- **双通道**：custom admin 不进 `requireAdmin()` 旧通道，新增 `getAdminAccessPayload()` / `requirePermission()` opt-in 通道；旧 `/api/admin/*` 默认 fail-closed
- **scope 数据源单一**：custom admin 写权限只看 `resource_permissions`，禁止新增 / 引用 `workflows.tenant_code/dept_id/team_id`
- **`.all` 守门**：仅 `super_admin` 能在 custom_roles 上授予 `.all` 后缀权限（R1.2 单列校验项）
- **`role ?? "super_admin"` 扫描**：独立 Phase 5 全仓清查

---

## 实施

### Phase -1 · DB · [supabase/migration_v50_custom_roles.sql](../../supabase/migration_v50_custom_roles.sql) 【新建】

**3 张新表 + workflows 加 2 列**：

```sql
CREATE TABLE custom_roles (
  id UUID PK, name UNIQUE, code UNIQUE, description, enabled BOOL,
  created_by UUID,  -- 无 FK · admins/users 双来源
  created_at, updated_at
);

CREATE TABLE custom_role_permissions (
  role_id UUID REFERENCES custom_roles ON DELETE CASCADE,
  permission_key TEXT,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX idx_role_permissions_role;

CREATE TABLE user_custom_roles (
  user_id UUID REFERENCES users ON DELETE CASCADE,
  role_id UUID REFERENCES custom_roles ON DELETE CASCADE,
  granted_by UUID,  -- 无 FK · 同上
  granted_at,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_custom_roles_user;

ALTER TABLE workflows
  ADD created_by_kind TEXT,            -- CHECK admin / custom_admin
  ADD created_by_role_code TEXT;
-- 历史回填：kind='admin', role_code=created_by_role
```

**关键决策**：
- `custom_roles.created_by` / `user_custom_roles.granted_by` **不加 FK** —— admin actor 来自 admins 表或 users 表（5.11up + 5.16up 双来源），与 v28 drop `audit_logs.admin_id` FK 同理。
- `workflows.created_by_role` 旧字段 + v31 CHECK **不动**；custom admin 新建工作流时 `created_by_role` 留 NULL，只填新的 `kind`+`role_code`。
- `permission_key` **不在 DB 加 CHECK** —— 唯一来源是 `lib/permission-keys.ts` 常量 + API 入参校验（避免 enum 改一次就发一次 migration）。
- 末尾 `NOTIFY pgrst, 'reload schema'`，与 v44 / 5.30up 系列保持一致。

**幂等**：所有 CREATE / ALTER 用 `IF NOT EXISTS`；backfill 用 `WHERE created_by_kind IS NULL` 守卫；CHECK 约束 `DROP IF EXISTS` + `ADD` 顺序确保重复跑安全。

### Phase -1 · MIGRATIONS 索引 · [supabase/MIGRATIONS.md](../../supabase/MIGRATIONS.md)

- 追加 v50 行（**6.4up · 权限管理 · 自定义角色基建**，含必跑后果提示）。
- 追加跨号说明：v45 跳号无对应文件；**v46~v49 占号在 feature/6.3up 分支**（工作流分层级配置：scope_order 表 / RPC / perms→order 触发器 / drop workflows.created_by FK），待 6.3up 合 master2 后本表会补齐 v46~v49 行；6.4up 的 v50 与 v46~v49 **互不依赖、可独立跑**。

---

## 分支策略 · 落地步骤

按用户拍板的「C 路径」执行：

1. **6.3up 收尾 commit**（仅 `app/admin/workflows/page.tsx`）
   - commit message：`6.3up · 收尾工作流卡片权限展示`
   - 内容：R1.14 工作流卡片去掉左侧竖向连接线（4 行改动）
   - 不带 `upgrade/6.4up/` 文件入 6.3up（untracked，git add 显式指定单文件）
2. **切 master2**：`git checkout master2`（确认 master2 tracking `origin/master2` up-to-date）
3. **新建 `feature/6.4up`**：`git checkout -b feature/6.4up`
4. **Phase -1 写文件**（本次产出，共 3 个）：
   - `supabase/migration_v50_custom_roles.sql`（新建）
   - `supabase/MIGRATIONS.md`（追加 v50 + 跨号说明）
   - `upgrade/6.4up/方案-权限管理-20260604.md`（R0 → R1.2 演进，写在 R1.x 评审期间）
   - `upgrade/6.4up/变更记录-20260604-permission-management.md`（本文件）

---

## 待办（下次会话进入 Phase 0）

按方案 R1.2 Phase 拆分顺序：

| Phase | 内容 | 工件 |
|---|---|---|
| -1 ✅ | DB · v50 | 本次产出 |
| 0 | `lib/permission-keys.ts` 常量 + 模板 / `AdminAccessPayload` 类型 / `PermissionActor` 类型 / `getAdminAccessPayload()` / `requirePermission()` / `hasPermission()` / `hasAnyCustomRole()` | TS 新增 |
| 1 | admin login / elevate / `/api/me` / `/api/admin/me` 接入；`requireAdmin()` 保持 builtin-only | TS 改造 |
| 2 | custom-roles CRUD API + user 授予/撤销 + audit + `permission_key` 校验 + `.all` 仅 super_admin 闸门 | TS 新增 |
| 3 | `admin-layout` skeleton + permission nav + 权限管理页 | TSX 改造 |
| 4 | workflow 试点：GET/POST/PATCH + step POST/PUT/PATCH 接入 `requirePermission()` | TS 改造 |
| 5 | 全仓扫描 `role ?? "super_admin"` / `requireAdmin()` 裸路由 / custom 可达面 | 报告 + 修复 |
| 6 | CI + 实测 22 项 + 变更记录补全 + commit | 收口 |

**DB 部署节奏**：v50 SQL **暂不在 supabase 跑**，等 Phase 0~4 TS 代码就绪、用户拍 6.4up 上线节点时一并跑（参照 6.3up 的 v46~v49 节奏：先码后跑）。dev DB 已独立（[`project_dev_db_independent`](../../../memory/project_dev_db_independent.md)），不再有 ENCRYPTION_KEY 对齐顾虑。

---

## 状态（Phase -1）

- 当前分支：`feature/6.4up`（已从 master2 拉出，本次 commit 前为空）
- Phase -1 commit：`0571ac9 · 6.4up Phase -1 · DB · v50 custom roles + workflows creator kind`
- 未跑 SQL：v50 留在仓库，待全部 Phase 完成 + 用户拍板上线节点

---

## Phase 0 · 核心 helper（已落地）

### `lib/permission-keys.ts`【新建】

- `PERMISSION_KEYS` 常量 · 12 条（workflow read/create/update × team/dept/org/all）
- `PermissionKey` 类型 · readonly tuple 派生
- `isPermissionKey(x)` · runtime 校验（API 入参用）
- `getPermissionScopeSuffix / getPermissionAction / getPermissionResource` · 解析 key 各段
- `requiresSuperAdminToGrant(key)` · `.all` 守门判定
- `PERMISSION_TEMPLATES` · 4 个内置模板（group_leader / dept_manager / org_content_ops / org_auditor）

**决策**：模板不入 DB；DB 不加 CHECK；唯一来源在 TS 常量。

### `lib/auth.ts`【扩展】

- 新增 `CustomAdminPayload`（discriminated by `source: 'custom_admin'`，含 `userId` 不含 `adminId/role`）
- 新增 `AdminAccessPayload = AdminPayload | CustomAdminPayload`
- `AdminPayload.source?: 'admin_table' | 'user_admin'` 可选字段（旧 token 无此字段 → 默认 `admin_table`）
- 类型守卫 `isCustomAdminPayload` / `isBuiltinAdminPayload`
- `getCurrentAdmin()` 显式拒绝 custom（return null）→ 旧通道仍只识别 builtin
- 新增 `getCurrentAdminAccess()` 同时支持 builtin / custom
- 新增 `validateCustomAdminTokenFreshness()` · 复用 `users.force_relogin_at` 同步语义

### `lib/permission-actor.ts`【新建】

- `PermissionActor` 类型 · 含 actorId / source / tenantCode / deptId / teamId / userType / builtinRole / customRoleCodes / permissions / username
- `buildPermissionActor(payload)` · 从 access payload 派生（builtin 走 admins/users 双源；custom 走 users + user_custom_roles + custom_role_permissions）
- `hasAnyCustomRole(userId)` · admin/login / elevate / `/api/me` 用的快速判定
- `hasPermission(actor, key, targetScopes?)` · 业务判定核心；builtin 走旧 role 规则，custom 走 permission keys + scope 包含
- `listReadableScopes(actor)` · list 路径筛选辅助（按 .all > .org > .dept > .team 优先）
- scope 包含关系 `isScopeWithinActorRange` / `isScopeWithinOrg` · 按 team ⊂ dept ⊂ org ⊂ all 判定

### `lib/session.ts`【扩展】

- `getAdminAccessPayload()` · `requireAdmin()` 通道之外的双通道入口
- `requirePermission(key)` · 单 key 校验 + 返回 actor（401/403 自动）
- `requirePermissionForScopes(key, scopes[])` · 已知目标 scope 时的一步到位
- builtin firstLogin 守门复用既有 `requireAdmin` 同款逻辑

### `middleware.ts`【扩展】

- 识别 `isCustomAdminPayload` → 走 `validateCustomAdminTokenFreshness`（不查 `admins.force_relogin_at`）
- custom admin 无 `firstLogin` 概念，跳过强制改密分支
- 与 builtin 共用 admin cookie（同一 cookie，payload 形态自我区分）

**Phase 0 typecheck：✅ pass**

---

## Phase 1 · 入口链路扩展（已落地）

### `app/api/admin/login/route.ts`

- admins 表分支签 token 时新增 `source: 'admin_table'`
- users 表 role∈3档 分支签 token 时新增 `source: 'user_admin'`
- users 表 role='user' 但 `hasAnyCustomRole(userId)=true` → 签 custom access cookie（`source: 'custom_admin'`，无 adminId / role / firstLogin）
- 关键：custom 路径不走 builtin AdminPayload，避免 `role ?? "super_admin"` 误判

### `app/api/auth/elevate-to-admin/route.ts`

- 同口径：role='user' + hasAnyCustomRole → 签 custom access cookie
- builtin 路径 token 新增 `source: 'user_admin'`

### `app/api/me/route.ts`

- `isAdmin = builtinAdmin || (await hasAnyCustomRole(user.userId))`
- 前端「管理后台」按钮现在也对持有 custom role 的 role='user' 用户显示

### `app/api/admin/me/route.ts`【重写】

- 改用 `getAdminAccessPayload + buildPermissionActor`
- custom 分支返回 `{ source: 'custom_admin', userId, username, builtinRole: null, tenantCode, deptId, teamId, userType, customRoleCodes, permissions[] }`
- builtin 分支返回 `{ source, adminId, username, role, builtinRole, tenantCode, deptId, teamId, userType, customRoleCodes: [], permissions: [] }`
- 仅服务于前端菜单 / 上下文展示；不是业务写权限入口

**Phase 1 typecheck：✅ pass**

---

## Phase 2 · 后端 CRUD API（已落地）

### `lib/audit.ts`【扩展】

- `AuditResourceType` 加 `'custom_role'`（CRUD + 授予/撤销共用）

### `app/api/admin/custom-roles/route.ts`【新建】

- `GET` · super_admin only · 列出 roles + 每个 role 的 permissions[] + 绑定用户数
- `POST` · super_admin only · 创建 role
  - `code` 校验：`/^[a-z][a-z0-9_]*$/`
  - permission_keys 必须全部命中 `PERMISSION_KEYS`
  - `.all` 后缀只能由 super_admin 授予（R1.2 决策 10 单列校验）
  - name / code 重名前置检查
  - 写 `audit_logs(resource_type='custom_role', action='create', detail={code, permissions})`

### `app/api/admin/custom-roles/[id]/route.ts`【新建】

- `GET` · super_admin only · 单 role + permissions + bindings
- `PATCH` · super_admin only · 更新 name / code / description / enabled / permissions（permissions 全量替换；`.all` 守门同 POST）
- `DELETE` · super_admin only · CASCADE 清理 custom_role_permissions / user_custom_roles
- 全部写 audit

### `app/api/admin/user-custom-roles/route.ts`【新建】

- `POST` · super_admin only · 授予 `{user_id, role_id}`
  - 校验 user 存在 + status='active'
  - 校验 role 存在 + enabled=true
  - **拒绝**：把 custom role 挂到 builtin admin（决策 4：admin 走原 RBAC）
  - 幂等（已绑定 → 返回 `already_granted: true`）
  - 审计 detail：`{event: 'grant', user_id, user_label, role_code}`
- `DELETE` · super_admin only · 撤销 `?user_id=&role_id=`（query 或 body 任一）
- 审计 action 复用 `'update'`（不改 audit_logs.action CHECK 约束）

### `app/api/admin/permission-keys/route.ts`【新建】

- `GET` · super_admin only · 暴露 `PERMISSION_KEYS` 元数据 + `PERMISSION_TEMPLATES` 给前端 UI 渲染

**Phase 2 typecheck：✅ pass**

---

## Phase 3 · admin-layout + 权限管理页（已落地）

### `components/layout/admin-layout.tsx`【改造】

- `adminRole` 初始值 `null`（不再默认 `super_admin`），me 加载前 nav 渲染骨架，不闪超管菜单 ← P1-1 修复
- `NavItem` 加 `customAccess?: 'workflow_any'` 字段
- 新增 `accessSource` / `customPermissions` / `meLoaded` 三态
- `navItemVisible(item)`：
  - builtin → 按 `allowedRoles`
  - custom → 按 `customAccess`（workflow_any: 持有任一 `workflow.*` permission 则显示）
- custom admin 无可见菜单时主区域显示兜底页「尚未配置后台权限」
- 增加 `/admin/permissions`（KeyRound icon · SUPER_ONLY）

### `app/admin/permissions/page.tsx`【新建】

- 卡片列表显示所有 custom roles + permission chips + 用户数 + 启停状态
- 新建 / 编辑 modal：
  - name / code / description / enabled
  - 4 个内置模板按钮（一键填充 permissions）
  - 权限矩阵按 resource → action × scope 渲染，可勾选
  - `.all` 后缀 chip 标 "（限超管）"
- 用户授予 / 撤销 modal：
  - 搜索用户（仅 `role=user`，复用 `/api/admin/users?search=&role=user`）
  - 列出已绑定用户 + 时间 + 撤销按钮
- 403 兜底：page mount 时检测 → router.replace('/admin/dashboard')

**Phase 3 typecheck：✅ pass**

---

## Phase 4 · workflow 试点改造（已落地）

### `app/api/admin/workflows/route.ts`

- `GET` 头部改用 `getAdminAccessPayload`，custom 分支：
  - 检查持有任一 `workflow.read.*`（否则空列表）
  - `computeCustomAdminVisibleWorkflowIds(actor)` 从 `resource_permissions` 反查可见 workflow id 集
  - 落入下方公共 DB 查询
- `POST` 头部加 custom 分支：
  - `pickCreateKey(actor)` 取最高级 create key（.all > .org > .dept > .team）
  - 按 suffix 决定 scope_type / scope_id：team→actor.teamId，dept→actor.deptId，org→actor.tenantCode，all→null
  - workflow 落库：`visible_to='custom'`, `created_by=actor.actorId`, `created_by_kind='custom_admin'`, `created_by_role_code=actor.customRoleCodes[0]`（不写 created_by_role）
  - 写一条 resource_permissions 对应 scope
  - audit detail 含 `created_by_kind / created_by_role_code / permission_key / scope`

### `app/api/admin/workflows/[id]/route.ts`

- `PATCH` 头部加 custom 分支：
  - `pickUpdateKey(actor)` 取最高级 update key
  - 取目标 workflow 的全部 scopes（`getWorkflowScopes`）；无 scope 直接 403（不用 `visible_to` 字面值兜底）
  - `hasPermission(actor, key, scopes)` 必须全部落在 actor 权限范围内
  - **DENY** 改 `enabled`（不能启停）/ `visibleTo` / `permissions`（不能扩散可见性）
  - 允许：name / description / category / sortOrder / categoryIds
- `DELETE` 仍用 `requireAdmin()` → custom admin fail-closed

### `app/api/admin/workflows/[id]/steps/route.ts`

- `POST` / `PUT` 双通道：
  - custom 分支 `pickStepUpdateKey(actor)` + `hasPermission(actor, key, parentWorkflowScopes)`
  - 视为 workflow update
- 保留 builtin 上下级 + org_admin 归属校验

### `app/api/admin/workflow-steps/[id]/route.ts`

- `PATCH` 双通道；custom 分支同上 scope 校验
- custom admin **DENY** 改 step `enabled`（不能启停步骤）
- `DELETE` 仍 `requireAdmin()` → custom admin fail-closed

**Phase 4 typecheck：✅ pass**

---

## Phase 5 · 安全扫描（已完成）

### `role ?? "super_admin"` 扫描结果

| 命中位置 | 是否风险 | 处置 |
|---|---|---|
| `lib/auth.ts:74` 注释 | ❌ | 仅文档 |
| `app/api/admin/me/route.ts:20` 注释 | ❌ | 仅文档 |
| `app/api/admin/agents/route.ts:171` 等 agents 写路径 | ❌ | `requireAdmin()` 已拒 custom |
| `app/api/admin/workflows/route.ts:308 / 355` builtin POST 分支内 | ❌ | 在 `isCustomAdminPayload(access)` 分支后，admin 必为 AdminPayload |
| `app/api/admin/workflows/[id]/route.ts:59 / 244 / 332` builtin 分支 | ❌ | 同上 |
| `app/api/admin/workflows/[id]/steps/route.ts:116 / 201` builtin else 分支 | ❌ | 同上 |
| `app/api/admin/workflows/[id]/duplicate/route.ts:28` workflow 复制 | ❌ | custom admin v1 不开放此能力；`requireAdmin()` fail-closed |
| `app/api/admin/workflow-steps/[id]/route.ts:53` builtin else 分支 | ❌ | 同上 |

**结论**：全部命中均为 builtin-only 可达路径或纯注释，custom admin 无任何 `?? "super_admin"` 兜底可达。

### 旧 `/api/admin/*` 路由 fail-closed 验证

- 全部 55 条 admin 路由均使用 `requireAdmin` / `getAdminAccessPayload` / 直接调本次新增的 `requirePermission`
- `requireAdmin()` 在 `getCurrentAdmin()` 阶段 `isCustomAdminPayload(payload) → return null`，custom admin 必拒
- custom admin 可达白名单（共 7 个端点）：
  - `/api/admin/me` GET（身份上下文）
  - `/api/admin/workflows` GET / POST
  - `/api/admin/workflows/[id]` PATCH（DELETE 仍 builtin-only）
  - `/api/admin/workflows/[id]/steps` POST / PUT
  - `/api/admin/workflow-steps/[id]` PATCH（DELETE 仍 builtin-only）
- 其余 48 条 admin 路由（users / tenants / analytics / settings / 知识库 / model-providers / agents / categories / 等）均 `requireAdmin()` fail-closed

### lint / typecheck

- `npm run ci:typecheck` ✅ 0 errors
- `npm run ci:lint` ✅ 0 errors（1 个 warning 是历史 `agents/[id]/page.tsx`，与本次改动无关）

---

## Phase 6 · 收口

- ✅ Phase 0–4 全部 typecheck 通过
- ✅ Phase 5 安全扫描完成，无 custom admin 越权路径
- ✅ lint 通过（无新增 warning）
- ✅ 变更记录持续追加（本文件）
- ⏳ 待用户手动验收 22 项（见方案 § 验收清单）
- ⏳ 待用户在 supabase dev DB 跑 v50 migration（dev DB 已独立 `ysgdmdqygbvfthzylhqn`）
- ⏳ 待用户拍板上线节点 → 在生产 supabase 跑 v50 + 部署

---

## 待办（v1 收口后下一波）

R1.2 § 不在本期范围明示不做的项目，留作 v1.1+ 视用户反馈再上：

- workflow delete / enable / disable / duplicate 开放给 custom admin
- workflow step delete / enable / disable 开放给 custom admin
- `group`(user_groups) scope
- org_admin 在本组织建组织级角色
- 角色继承 / 嵌套 / 时间窗口
- 资源 id 级权限
- agent / knowledge_base / tag / user / department / team 等其他模块加入 permission_key 体系

---

## 部署 Runbook（待用户拍板节点）

1. **dev DB 验证**
   - 在 supabase 项目 `ysgdmdqygbvfthzylhqn` SQL Editor 跑 `migration_v50_custom_roles.sql`
   - SELECT 验证 3 张表 + workflows 2 列 + workflows 历史行已回填 `created_by_kind='admin'`
2. **dev 实测 22 项**（见方案 § 验收清单）
3. **生产 supabase** 跑同款 SQL
4. **Vercel** 部署 feature/6.4up（合并 master2 → 自动部署）
