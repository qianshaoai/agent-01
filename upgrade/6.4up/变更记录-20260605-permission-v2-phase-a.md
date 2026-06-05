# 6.4up · 权限管理 v2 · Phase A 实施变更记录

**日期** 2026-06-05
**分支** feature/6.4up
**方案** [方案-权限管理v2-合并版-20260605.md](./方案-权限管理v2-合并版-20260605.md)
**矩阵** [矩阵-资源权限现状-20260605.md](./矩阵-资源权限现状-20260605.md)
**审计原始** [审计-原始-20260605.md](./审计-原始-20260605.md)

---

## 主题

Phase A 基建落地 —— **行为零变化**版本：
- v52 表 + seed + RPC 入库（但 `PERMISSION_V2_ENFORCE_RESOURCES` 未启用 → facade 全 no-op）
- 应用层 keys 重构 / actor v2 公式 / facade + 13 adapter 全部就绪
- 管理 API：admin-overrides 新建 / custom-roles 严校 WORKFLOW set / permission-keys 按 set 分组返 / users set-role 调 RPC

可上线（行为等价 6.4up）。Phase B（UI 4 Tab）+ Phase C-E（路由分阶段 enforce）后续推进。

---

## 1. DB · v52 migration

**新建** [`supabase/migration_v52_permission_v2.sql`](../../supabase/migration_v52_permission_v2.sql)（~290 行）：

- 表 `builtin_role_permissions(role, permission_key, updated_at, updated_by)` + PK + 索引
- 表 `admin_permission_overrides(admin_source, admin_id, permission_key, effect, reason, created_by, created_at)` + PK + 索引
- seed `system_admin` 默认包 109 keys（与现状代码完全等价；零默默放权）
- seed `org_admin` 默认包 64 keys
- RPC `change_user_role_clear_custom(p_user_id, p_new_role, p_actor_id)` 一次事务做 UPDATE role + DELETE user_custom_roles + INSERT audit_logs

**MIGRATIONS.md** 追 v52 条目；标 🔑 必跑（仅当 env 启用 enforce 时才必须）。

**上线策略**：
- v52 跑完后**默认不影响任何路由**（PERMISSION_V2_ENFORCE_RESOURCES 留空 → facade no-op）
- 验证 effective set 工作：手动设 env = `"notice"` 后 `/api/admin/notices` 走 v2 路径

---

## 2. 应用层基建

### 2.1 `lib/permission-keys/` 目录化

**删除** `lib/permission-keys.ts`（旧单文件）。
**新建** 4 文件：
- `lib/permission-keys/workflow.ts` —— `WORKFLOW_PERMISSION_KEYS`（12 keys，与 6.4up 旧 PERMISSION_KEYS 完全一致）+ `PERMISSION_TEMPLATES`
- `lib/permission-keys/agent-draft.ts` —— `AGENT_DRAFT_PERMISSION_KEYS`（14 keys）
- `lib/permission-keys/admin.ts` —— `ADMIN_PERMISSION_KEYS`（v2 通道全集）+ `KEYS_BY_RESOURCE`
- `lib/permission-keys/index.ts` —— 聚合 + dedup + helpers + `PERMISSION_KEYS` re-export 向后兼容

所有 `from "@/lib/permission-keys"` 现有 import 自动解析到 `index.ts`，零路径修改。

### 2.2 `lib/permission-actor.ts` · v2 公式

- `PermissionActor` type 新增 `effectivePermissions: Set<string>` 字段（builtin admin 通道用）
- `buildBuiltinAdminActor` 在 `PERMISSION_V2_ENFORCE_RESOURCES` 非空时额外查 `builtin_role_permissions[role]` ∪ `admin_permission_overrides[grant] − [revoke]` 合成 effective set；env 空时跳过查询（actor.effectivePermissions 为空 set）
- `hasPermission` 公式重写：
  1. `actor.builtinRole === "super_admin"` → return true（公式第 1 行硬全权）
  2. builtin path：`effectivePermissions.size > 0` 走新公式（`finalKeys.has(key) && scopeOk`），否则退回旧 role-based fallback（保 6.4up 行为）
  3. custom path：不变（`actor.permissions` + scope）

### 2.3 `lib/access-facade.ts` 新建（~180 行）

- `ResourceAccessAdapter<TRow>` 接口（5 方法异步）
- `registerAccessAdapter` / `getAccessAdapter` REGISTRY
- `isResourceEnforced(resourceKind)` —— 解析 `PERMISSION_V2_ENFORCE_RESOURCES` CSV
- `requireAccess(actor, resourceKind, action, opts)`：
  - flag 不含 → **立即 return null（完全 no-op）**
  - super_admin → return null
  - 否则委托给 adapter.checkRead / checkWrite；adapter 抛错 → 500（方案 R11）

### 2.4 `lib/audit.ts` 扩 2 case

`AuditResourceType` 加：
- `'builtin_role_permission'`（Tab 2 编辑 system_admin / org_admin 默认包时写 audit；tenant_code = NULL 平台级）
- `'admin_override'`（Tab 1 编辑某 admin 个人权限时；按 target admin id 反查 tenant）

`resolveResourceTenantCode` 加对应分支。

### 2.5 13 adapter · `lib/adapters/access/*.ts`

骨架版 stub —— flag 空时是死代码，行为完全等价 6.4up：
- `_generic.ts`：`buildTenantOwnedAdapter` + `buildPlatformAdapter` helper
- `knowledge-base.ts` / `model-provider.ts` / `notice.ts` / `dept.ts` / `team.ts` / `agent.ts` / `agent-draft.ts` / `workflow.ts` / `user.ts` / `audit.ts`：tenant-owned 模式 stub（每个 ~10 行）
- `tenant.ts` / `category.ts`：platform-level stub
- `setting.ts`：super-only（不入 seed，硬拒非 super）
- `index.ts`：统一注册入口

**Phase A 阶段所有 adapter 是 stub**：
- `loadDetail` 直接按 id select
- `checkRead/checkWrite` 委托给 `hasPermission`（flag 空时走旧 fallback）
- `resolveCreateOwnership` 默认返回 `tenant_code = actor.tenantCode`

Phase C-E enforce 启用前必须按 resource 精化：
- workflow → 反查 `resource_permissions` 拿 scope_type/scope_id
- agent → 反查 `tenant_agents` M2M
- agent_draft → 反查 `users(created_by).tenant_code`
- user → 复刻 `lib/admin-permissions.ts canActOnRole`

---

## 3. API 改 / 新建

### 3.1 `app/api/admin/custom-roles/route.ts` + `[id]/route.ts`

写入校验从 `isPermissionKey`（全 set）→ `isWorkflowPermissionKey`（仅 12 workflow keys）。
报错文案改为"不在 workflow 自定义角色合法清单中"以区分 admin-overrides 通道。

### 3.2 `app/api/admin/users/[id]/route.ts` · set-role 调 RPC

旧：`db.from("users").update({ role })`
新：role 从 `'user'` 变 builtin admin 时调 `db.rpc("change_user_role_clear_custom", { p_user_id, p_new_role, p_actor_id })`，一次事务清 user_custom_roles + 写 audit。

兼容降级：RPC 不存在（code 42883）→ fallback 到旧 update 路径，避免 v52 未跑时 500。

### 3.3 `app/api/admin/permission-keys/route.ts` · 按 set 分组返

返回结构扩展：
```json
{
  "keys": [...],                    // 兼容：所有 keys 描述
  "templates": {...},               // 兼容
  "workflow": [...],                // 6.4up v2 新：WORKFLOW set
  "admin": [...],                   // 6.4up v2 新：ADMIN set
  "by_resource": {                  // 6.4up v2 新：按资源分组（UI Tab 1/2 用）
    "workflow": [...],
    "agent": [...],
    ...
  }
}
```

### 3.4 `app/api/admin/admin-overrides/route.ts` 新建（~140 行）

- `GET` 列出所有 override
- `POST` upsert 一条 override（grant/revoke）：
  - 入参严校 `isAdminPermissionKey`
  - 禁止 `setting.*` / `permission.*` 前缀（方案验收 #7）
  - 写 audit（resource_type='admin_override'）

### 3.5 `app/api/admin/admin-overrides/[adminId]/route.ts` 新建（~100 行）

- `GET ?source=admin_table|user_admin` 列出单 admin 的 overrides
- `DELETE ?source=&key=` 删一条；不传 key 一次清空该 admin 全部 override

---

## 4. 工具脚本

### `scripts/audit-permission-coverage.ts` 新建（~120 行）

扫 `app/api/admin/**/route.ts` 提取 role 校验 pattern（requireWriteAccess / admin.role 比较 / ROLES 常量），输出 markdown 给人工对照。

跑过：`npx tsx scripts/audit-permission-coverage.ts > upgrade/6.4up/审计-原始-20260605.md`

---

## 5. 不动的部分

- `lib/scoped-access.ts`（被 adapter 在 Phase D-E 时调用）
- `lib/admin-permissions.ts`（user adapter Phase D 时复用 canActOnRole）
- `requireAdmin()` / `requirePermission()` 双通道语义保持
- 60+ 现存 admin 路由（未接入 facade）
- v50 / v51 migration

---

## 6. CI

- `npm run ci:typecheck` ✅ 0 errors
- `npm run ci:lint` ✅ 0 errors（仅历史 `agents/[id]/page.tsx:778` warning）
- v52 SQL 文件未跑（按方案 §3.4：env 空时跑不跑都不影响应用层）

---

## 7. 验收（方案 §5 · Phase A 相关项）

**待手动验证**：

- ✅ #1 super_admin 任何操作仍放行 —— 公式第 1 行硬规则就绪
- ✅ #14 v52 启用后 custom_admin 12 个 workflow keys 仍能工作 —— 双通道隔离硬规则就绪（custom 通道 `requirePermission()` 不读 v52 两表）
- ✅ #15 role 晋升清 `user_custom_roles` —— RPC `change_user_role_clear_custom` + 路由调用就绪
- ✅ #16 system_admin 不能 POST /api/admin/model-providers —— seed 中 system_admin 默认包**不含** `provider.create.*`
- ✅ #19, #20 待 Phase B UI 接入后联调

**enforce 切换验证**：
- 跑 v52 + 设 `PERMISSION_V2_ENFORCE_RESOURCES="notice"` → `GET/POST /api/admin/notices` 走 v2 facade（adapter 接通；list filter null 不影响 list；写操作经 checkWrite）

---

## 8. 接下来 · Phase B / C 入口

- **Phase B**（~8h）：`app/admin/permissions/page.tsx` 4 Tab UI；admin-overrides 前端 grant/revoke；effective 矩阵展示；二次确认对话框
- **Phase C**（~4h）：低风险路由接入 `requireAccess` —— `notice / category / analytics / audit`；CSV 加 `"notice,category"` 开 enforce

本次 commit 已具备 Phase B 启动条件。
