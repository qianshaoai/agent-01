# 6.4up · 权限管理 v2 · Phase C · 变更记录

**日期** 2026-06-06
**分支** feature/6.4up（commit `c74fa3a` Phase B 之上）
**方案** [`方案-权限管理v2-PhaseC-R0-20260606.md`](./方案-权限管理v2-PhaseC-R0-20260606.md)
**审批** 用户拍板 GO + 2 条硬约束（HC1 / HC2）

---

## 主题

4 个低风险 resource 路由叠加 v2 `requireAccess` / env-gated `hasPermission`：
- `notice`（list / create / [id] update / [id] delete）
- `category`（list / create / [id] read / [id] update / [id] icon update / [id] icon "delete"）
- `analytics`（list-level，复用 `audit.read.*` D1）
- `audit-logs`（list-level）

**性质** = 纯路由叠加 + env 切换；生产 `PERMISSION_V2_ENFORCE_RESOURCES` 仍空 → 任何路由完全 no-op，行为零变化。

---

## 1. 顺序与边界（用户拍板）

```
A. 删 G:\zhinengticang 上层 stray lockfile          ✓ build warning 消失
C. 查 dev 残留 → 发现 dev DB 未跑 v52              ✓ 报告给用户
   → 用户拍板：代码先推 + dev 联调前用户手跑 v52
3. 实施 notice / category / analytics / audit       ✓ 本期完成
4. dev 联调前提：用户手跑 v52 → set env="notice,category"  待用户
5. 验通 → set env="notice,category,analytics,audit"        待用户
6. 生产 / staging env 始终空                                合约
```

dev DB（`ysgdmdqygbvfthzylhqn`）状态：未跑 v52，`builtin_role_permissions` 不存在。
[`scripts/check-phase-c-pre.ts`](../../scripts/check-phase-c-pre.ts) 启动前必跑 → 若返 ✅ 则可开 enforce。

---

## 2. HC1 · analytics 内联 `hasPermission` 必须受 env gate 控制

[`app/api/admin/analytics/route.ts`](../../app/api/admin/analytics/route.ts) 顶部：

```ts
if (isResourceEnforced("analytics") && admin.role !== "super_admin") {
  const actor = await buildPermissionActor(admin);
  const okOrg = actor.tenantCode
    ? await hasPermission(actor, "audit.read.org", [{ scope_type: "org", scope_id: actor.tenantCode }])
    : false;
  const okAll = await hasPermission(actor, "audit.read.all");
  if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
}
```

- env 空 → `isResourceEnforced("analytics")` 返 false → 整段跳过 → 行为零变化
- env `"analytics"` 含 → 进 v2 判定；fail-closed 403
- 复用 `audit.read.{org,all}` keys（D1，不动 ADMIN_PERMISSION_KEYS / v52 seed）

---

## 3. HC2 · list 不走 facade · 走 env-gated `hasPermission`

facade 的 `requireAccess` read 分支强制需要 row（[access-facade.ts:159-166](../../lib/access-facade.ts#L159)）。list 路径无 row → 不能裸调 `requireAccess(..., "read")`。

本期 4 个 list 路径统一改用 env-gated `hasPermission` 做粗粒度 check：

| 路由 | check |
|---|---|
| `GET /api/admin/notices` | `notice.read.org` (with actor.tenantCode) OR `notice.read.all` |
| `GET /api/admin/categories` | `category.read.all`（platform-level） |
| `GET /api/admin/categories/[id]` | `category.read.all` |
| `GET /api/admin/analytics` | `audit.read.org` OR `audit.read.all`（D1 复用） |
| `GET /api/admin/audit-logs` | `audit.read.org` OR `audit.read.all` |

非 list 路径仍用 facade：
- POST `create` → `requireAccess(actor, kind, "create")` → 命中 adapter.checkCreate（Phase A R1 F4 已就绪）
- PATCH/DELETE → 先 load row → `requireAccess(actor, kind, "update"|"delete", { row })` → adapter.checkWrite

---

## 4. 路由级改动清单

### 4.1 · `notice`

| 文件 | 改动 |
|---|---|
| [`app/api/admin/notices/route.ts`](../../app/api/admin/notices/route.ts) | GET：env-gated `notice.read.{org,all}`（OR）；POST：env-gated `requireAccess create` |
| [`app/api/admin/notices/[id]/route.ts`](../../app/api/admin/notices/%5Bid%5D/route.ts) | PATCH / DELETE：先 load `tenant_code` → env-gated `requireAccess update` / `delete` with row；旧 org_admin tenant 强制保留作 fail-fast 第二道 |

### 4.2 · `category`

| 文件 | 改动 |
|---|---|
| [`app/api/admin/categories/route.ts`](../../app/api/admin/categories/route.ts) | GET：env-gated `category.read.all`；POST：env-gated `requireAccess create` |
| [`app/api/admin/categories/[id]/route.ts`](../../app/api/admin/categories/%5Bid%5D/route.ts) | GET：env-gated `category.read.all`；PATCH：先 load row → env-gated `requireAccess update` with `{ row: { id } }` |
| [`app/api/admin/categories/[id]/icon/route.ts`](../../app/api/admin/categories/%5Bid%5D/icon/route.ts) | POST / DELETE：都映射到 `category.update.all`（icon 是 category 字段，不视为 delete）；env-gated `requireAccess update`；旧 org_admin 拒保留 |

### 4.3 · `analytics`

[`app/api/admin/analytics/route.ts`](../../app/api/admin/analytics/route.ts) GET：HC1 env-gated 复用 `audit.read.*`（不走 facade，analytics 无 row 概念）。

### 4.4 · `audit`

[`app/api/admin/audit-logs/route.ts`](../../app/api/admin/audit-logs/route.ts) GET：env-gated `audit.read.{org,all}`（OR）。

不接 audit POST/PATCH/DELETE（路由不存在；audit_logs 只 INSERT 走 `lib/audit.ts writeAuditLog`，与 v2 enforce 无关）。

---

## 5. 不动 / 边界

- v52 migration 文件不动；生产 enforce flag 仍空
- `hasPermission` 公式不动（Phase A R1 已就绪）
- 13 adapter（含 `_generic.buildTenantOwnedAdapter` 注册的 `notice` adapter / `buildPlatformAdapter` 注册的 `category` adapter）不改
- `lib/permission-keys/*` 全集不动（D1 复用 audit.read.*，不新增 analytics key）
- 60+ 其它 admin 路由（kb / provider / agent / agent-builder / workflow / user / tenant / dept / team 等）未接 → Phase D/E
- 6.4up custom_admin 通道完全独立
- 5.30up 双闸（角色白名单 fail-fast）保留作第一闸；v2 是叠加的第二闸

### 行为零变化合约（关键）

- 生产 / staging env 空 → 4 个 resource 路由的所有 v2 块完全跳过 → 等价 6.4up + Phase A R1 + Phase B
- 即使 dev 跑 v52 + env `"notice,category"` 启用：默认包 seed 覆盖现有所有合法请求（system_admin 109 keys + org_admin 64 keys 与现状代码完全等价）
- 唯一可能差异：开 enforce + Tab 1/2 修改默认包/override 后才生效

---

## 6. CI 验收

| 项 | 结果 |
|---|---|
| `npm run ci:typecheck` | ✅ 0 errors |
| `npm run ci:lint` | ✅ 0 errors（仅历史 `agents/[id]/page.tsx:778` hook deps warning） |
| `npm run ci:build` | ✅ Compiled successfully · 56/56 pages（workspace warning 已消） |
| `npm run seed:check` | ✅ `[seed-check] OK · generate-permission-seed.ts 输出与 v52 INSERT 段一致` |

---

## 7. dev 联调步骤（待用户跑）

### Step 1 · dev DB 跑 v52

去 supabase（`ysgdmdqygbvfthzylhqn`）SQL Editor 跑 [`supabase/migration_v52_permission_v2.sql`](../../supabase/migration_v52_permission_v2.sql) 完整文件：
- 建 2 表 + seed 173 行 + RPC `change_user_role_clear_custom`
- 跑完后跑 `npx tsx scripts/check-phase-c-pre.ts` → 预期输出：
  ```
  system_admin: 109 keys (v52 seed 期望 109)
  org_admin:    64 keys (v52 seed 期望 64)
  total: 0
  ✅ dev 两表与 v52 seed 一致 + 无 override，可直接开 enforce 联调
  ```

### Step 2 · 开 `notice,category`

`.env.local`（不进 git）：
```
PERMISSION_V2_ENFORCE_RESOURCES=notice,category
```

重启 dev server。

### Step 3 · 验证

**notice**
1. super_admin 调任意 notice CRUD → 通
2. system_admin 默认包含 notice.* → 调 GET/POST/PATCH/DELETE → 通
3. Tab 1 给某 system_admin revoke `notice.delete.all` → 该 admin 删 notice → 403 "权限不足"
4. Tab 1 给 org_admin 已有的 notice.read.org → 列表 → 通（看到本组织 + 全局）
5. Tab 1 给 org_admin revoke notice.read.org → 列表 → 403
6. 旧 fail-fast 仍跑：org_admin 修改不属于自己组织的 notice → 403（v2 通过 + 旧 fail-fast 拒）

**category**
1. system_admin / org_admin 默认包都含 category.read.all → list 通
2. Tab 1 revoke category.read.all → 403
3. system_admin / org_admin 默认包含 category.create.all → POST 通
4. Tab 1 revoke category.create.all → 403

### Step 4 · 加 analytics + audit

```
PERMISSION_V2_ENFORCE_RESOURCES=notice,category,analytics,audit
```

重启 dev。验证：
1. system_admin / org_admin 默认包含 audit.read.org/all → analytics / audit-logs 都通
2. Tab 1 revoke audit.read.all + audit.read.org → 两端都 403

### Step 5 · 生产合规自检

生产 env 仍空。线上跑任何路由 → `isResourceEnforced` 全 false → v2 块跳过 → 行为零变化。

---

## 8. 文件清单

### 修改（6）

- `app/api/admin/notices/route.ts`
- `app/api/admin/notices/[id]/route.ts`
- `app/api/admin/categories/route.ts`
- `app/api/admin/categories/[id]/route.ts`
- `app/api/admin/categories/[id]/icon/route.ts`
- `app/api/admin/analytics/route.ts`
- `app/api/admin/audit-logs/route.ts`

### 新建（2）

- `scripts/check-phase-c-pre.ts`（dev 启动前的只读检查脚本）
- `upgrade/6.4up/方案-权限管理v2-PhaseC-R0-20260606.md`（含拍板段 + HC1/HC2）
- `upgrade/6.4up/变更记录-20260606-permission-v2-phase-c.md`（本文件）

### 删除（环境清理）

- `G:\zhinengticang\package.json`（误装 tsx 留下的 stray）
- `G:\zhinengticang\package-lock.json`（同上）

---

## 9. 上线策略

- **无新 migration**（v52 不重发；本期不动 schema）
- 合并：Phase C 作为 `c74fa3a` 之后的 follow-up commit 留 `feature/6.4up`
- **仍不进 5/19 上线包**（生产 enforce 留空）
- 生产 / staging env `PERMISSION_V2_ENFORCE_RESOURCES` 保持空

---

## 10. Phase D / E / F 入口（不变）

- Phase D（~6h）：user / agent / agent_draft / workflow / tenant 接入（中风险，含 workflow 这一最大资源）
- Phase E（~4h）：kb / provider / setting / permission + 联调 5.30up scoped-access
- Phase F（~4h）：admin-layout `requiredPermission` 字段 + 全仓 super_admin 二扫 + 废 canActOnRole + `seed:check` 进 `ci:test`

Phase C 完成 = enforce 链路在低风险面就绪；Phase D 启动条件具备。

---

## 11. 已知非阻断

- dev server 跑在 webpack 模式（与 Phase A/B 一致）；本期 build 走 webpack OK
- `agents/[id]/page.tsx:778` 历史 hook deps warning（与 Phase C 无关）
- `ci:test` 仍占位（Phase F 时把 seed:check 进 ci:test）
- dev 联调前**用户必须手跑 v52 到 dev DB**，否则开 enforce 会触发 Phase A R1 F1 fail-closed throw → 500

---

## R1 收口（2026-06-06）

**触发** 小B Phase C R0 验收退回 1 个代码阻断点
**审批** 用户拍板"按小B 建议修法"

### R1 阻断 · notice POST 在 enforce 下误拒 system_admin 全局公告

**根因**：

[`app/api/admin/notices/route.ts:51-54`](../../app/api/admin/notices/route.ts#L51) R0 实施在解析 body 算 `finalTenantCode` **之前**就调 `requireAccess(actor, "notice", "create")`。

facade 把 create 路径委托给 [`_generic.buildTenantOwnedAdapter.checkCreate:71`](../../lib/adapters/access/_generic.ts#L71)：

```ts
async checkCreate(actor) {
  if (!actor.tenantCode) return false;
  const key = `${config.permissionPrefix}.create.org` as PermissionKey;
  return await hasPermission(actor, key, [
    { scope_type: "org", scope_id: actor.tenantCode },
  ]);
}
```

`system_admin` 在 admins 表的 `tenant_code` 通常为 null → checkCreate 第 1 行直接返 false → 403。

但 v52 seed 给了 `system_admin` 完整 `notice.create.{org,all}`；按 v2 公式 system_admin 应能：
- 创建全局公告（finalTenantCode=null，需 `notice.create.all`）✓
- 创建任意组织公告（finalTenantCode=ORG，需 `notice.create.org` + scope）✓

R0 实施把这两条都误拒了，与 R0 验收口径 "system_admin notice CRUD 通" 直接冲突。

**修法**（按小B 建议 · Lane A · route 层不走 facade）：

[`app/api/admin/notices/route.ts`](../../app/api/admin/notices/route.ts) POST 调整顺序 + 双形态分支：

```ts
// 1. 先 parse body
const { tenantCode, content } = await req.json();
if (!content?.trim()) return apiError("公告内容不能为空", "VALIDATION_ERROR");

// 2. 业务转换（org_admin 强制本组织）→ finalTenantCode
let finalTenantCode = tenantCode?.trim().toUpperCase() || null;
if (admin.role === "org_admin") {
  if (!admin.tenantCode) return apiError("你没有关联组织", "FORBIDDEN");
  finalTenantCode = admin.tenantCode;
}

// 3. v2 第二闸（env-gated，按"最终归属"判定，不走 facade）
if (isResourceEnforced("notice") && admin.role !== "super_admin") {
  const actor = await buildPermissionActor(admin);
  const ok = finalTenantCode === null
    ? await hasPermission(actor, "notice.create.all")
    : await hasPermission(actor, "notice.create.org", [
        { scope_type: "org", scope_id: finalTenantCode },
      ]);
  if (!ok) return apiError("权限不足", "FORBIDDEN");
}

// 4. 业务 insert
...
```

清理 unused import：`requireAccess` 在 notices/route.ts 不再使用（POST 走 hasPermission；GET 也是）。`[id]/route.ts` 仍用 facade（PATCH/DELETE 有 row）。

### 不动 _generic.checkCreate

本期不改 [`lib/adapters/access/_generic.ts`](../../lib/adapters/access/_generic.ts) 的 `buildTenantOwnedAdapter.checkCreate`：

- 当前实现对"纯 tenant-owned 资源"（如 kb / model_provider 在某些场景）仍正确：actor 必须属于某 tenant 才能在 .org scope 内创建
- notice 是 admin set 里唯一明显的 "platform-or-org 双形态" + 业务转换路径；按 Lane A 路由层处理最直接
- 未来 Phase D/E 接 kb/provider 时若发现同类双形态，再统一抽 helper（YAGNI）

### 跨核对（category / analytics / audit）

| 资源 | POST 是否同类问题 | 结论 |
|---|---|---|
| `category` | 纯 platform（`.all` only）；`buildPlatformAdapter.checkCreate` 调 `category.create.all` | OK，无问题 |
| `analytics` | 无 POST | N/A |
| `audit` | 无 POST | N/A |

仅需修 notice POST。

### CI（R1 收口后）

| 项 | 结果 |
|---|---|
| `npm run ci:typecheck` | ✅ 0 errors |
| `npm run ci:lint` | ✅ 0 errors（仅历史 hook deps warning） |
| `npm run ci:build` | ✅ Compiled successfully · 56/56 pages |
| `npm run seed:check` | ✅ 0 diff vs v52 |

### 验收复跑（待 dev DB 跑 v52 后用户实测）

补一条 R1 关键验证：

- super_admin 调 POST /api/admin/notices（含 tenantCode=ORG / 不含 tenantCode）→ 通
- **system_admin（admins 表 tenant_code=null）调 POST 不含 tenantCode → 通**（创建全局；R1 修复点）
- system_admin 调 POST 含 tenantCode=DEMO → 通（创建 DEMO 组织公告，按 notice.create.org + scope）
- org_admin 调 POST 含 tenantCode=ANY → finalTenantCode 被业务转换覆盖为 admin.tenantCode；走 notice.create.org + scope=本组织 → 通
- Tab 1 给 system_admin revoke notice.create.all → 创建全局公告 → 403
- Tab 1 同 admin 仍持 notice.create.org → 创建任意组织公告 → 通
- Tab 1 给某 org_admin revoke notice.create.org → 创建本组织公告 → 403

### 上线策略

- 无新 migration；本期不动 v52
- 合并：R1 作为 `cbf8879` 之后的 follow-up commit 留 `feature/6.4up`
- 仍**不进 5/19 上线包**；生产 env 始终空

### 待跑

- 用户：手跑 v52 到 dev DB（ysgdmdqygbvfthzylhqn）→ 跑 `npx tsx scripts/check-phase-c-pre.ts` 验 ✅
- 用户：`.env.local` 设 `PERMISSION_V2_ENFORCE_RESOURCES=notice,category` → 实测 R0 + R1 全部 7 项 → 验通
- 用户：env 加 `analytics,audit` → 实测两类 → 验通
- Phase C 收口
