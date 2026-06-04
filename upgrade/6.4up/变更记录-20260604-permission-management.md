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

## 状态

- 当前分支：`feature/6.4up`（已从 master2 拉出，本次 commit 前为空）
- 未 commit：v50 SQL + MIGRATIONS.md 追加 + 方案文档 + 本变更记录（待用户拍板"现在 commit"再 commit）
- 不动代码：本次只动 DB 文件 + Markdown，不碰任何 TS / TSX
- 未跑 SQL：v50 留在仓库，待 Phase 0~4 完成 + 用户拍板上线节点
