# 6.4up · 权限管理 v2 · Phase D · 变更记录

**日期** 2026-06-06
**分支** feature/6.4up（Phase C R3 收口 commit 之上）
**方案** [`方案-权限管理v2-PhaseD-R0-20260606.md`](./方案-权限管理v2-PhaseD-R0-20260606.md)（R0.1 · 小B 复审通过 · 决策 D1–D10 已定）
**审批** 用户拍板 GO「现在就开写 D-0 代码」
**子阶段** **D-0 · adapter 重写 + generic create 修 + 纯逻辑单测**（本条）

---

## 主题

把 4 个 Phase A 占位 stub adapter（**workflow / agent / agent_draft / user**）重写成真实归属逻辑；
修 `_generic.checkCreate` 的 `.all`/`.org` 双形态 bug；新增一个**无 DB 依赖的纯逻辑单测**。

**性质** = 纯 adapter 层重写 + 一个 helper + 一个单测；**不动任何路由 / 不动 v52 seed / 不动 custom_admin 通道**。
**行为零变化合约**：生产 / staging `PERMISSION_V2_ENFORCE_RESOURCES` 始终空 → `requireAccess` 第 1 行 `isResourceEnforced` 命中 false → no-op，这些重写后的 adapter 是**死代码**，全仓行为 = Phase C 终态。

---

## 1. 背景（为什么 D-0 是主线）

R0.1 §1 / F0 已核：4 个 adapter 至今是 `buildTenantOwnedAdapter` 占位 stub，对 enforce 不可用——
- `workflows` / `agents` / `agent_drafts` 表**无 `tenant_code` 列**（已核 schema），generic 的 `select("id, tenant_code")` 在 enforce 下 → PostgREST 报错 → `loadDetail` 返 null → `requireAccess` 对 builtin admin 任意写操作返 **404**。
- `user` 不会 404 但 generic 只判 tenant_code，丢了 sub-action 粒度 + 上下级语义。

D-0 把这 4 个改成真实逻辑（flag 空时仍是死代码，零行为变化），为 D-1~D-5 逐组 enforce 打底。

---

## 2. TDD · 纯逻辑单测（RED → GREEN）

`resource_permissions.scope_type` ∈ `all/org/dept/team/user/user_type`（六种，migration_v8），
但 `hasPermission` 的 `ResourceScope` 只认 `all/org/dept/team`（四种）。映射时**必须丢弃 `user`/`user_type`**
（那是"资源对哪些用户可见"维度，不参与 admin 权限 scope 判定）；漏过滤 = 把"指定用户可见"误当 org scope = 越权。

这层过滤是 D-0 最易出 bug 处，按 TDD 先写失败测试再实现：

- **RED** [`scripts/phase-d-scope-utils.test.ts`](../../scripts/phase-d-scope-utils.test.ts)（tsx，无 DB，沿用 `check-permission-seed.ts` 的退出码约定）→ 先跑 → `MODULE_NOT_FOUND`（_scope-utils 不存在），失败原因正确。
- **GREEN** 新建 [`lib/adapters/access/_scope-utils.ts`](../../lib/adapters/access/_scope-utils.ts)（**仅 `import type`，不 import db**，故可在无 Supabase env 下单测）→ 7 个断言全过。

```
npx tsx scripts/phase-d-scope-utils.test.ts
  ✅ org 行保留 / all 归一 null / dept+team 保留 / user·user_type 丢弃 / 混合只留 hierarchy / 空→空 / 未知丢弃
✅ 全部通过
```

> **DB-glue 不在本单测范围**：adapter 的 `loadDetail`（查 resource_permissions / users）与 `checkRead/checkWrite`（调 `hasPermission` → Supabase）是 DB 耦合层，由 **D-1 起的 dev-DB function-level smoke** 覆盖（沿用 Phase C `phase-c-smoke.ts` 模式）。本仓库无 jest/vitest，未引入新测试依赖。

---

## 3. 文件清单

### 新建（2）
| 文件 | 内容 |
|---|---|
| [`lib/adapters/access/_scope-utils.ts`](../../lib/adapters/access/_scope-utils.ts) | 纯函数 `mapResourcePermissionRowsToScopes`（过滤 user/user_type）+ `scopesFromTenantCode`；无 db 依赖 |
| [`scripts/phase-d-scope-utils.test.ts`](../../scripts/phase-d-scope-utils.test.ts) | 上述纯函数的 tsx 单测（7 断言，退出码 0/1） |

### 修改（2）
| 文件 | 改动 |
|---|---|
| [`lib/adapters/access/_generic.ts`](../../lib/adapters/access/_generic.ts) | ① `buildTenantOwnedAdapter.checkCreate` 修双形态（R0.1 F2 / §5.5 · 决策 D2=a）：先 `.all` 兜底再 `.org`，修复 system_admin（无 tenantCode）持 `.all` 建全局资源被误拒；② 新增导出 helper `checkAnyScopedPermission`（4 adapter 共用的 suffix 循环） |
| [`lib/adapters/access/team.ts`](../../lib/adapters/access/team.ts) | 仅注释：teams 自 v13 起**有** tenant_code，更正早期"无 tenant_code"误注（generic 列层面可用，逻辑不变） |

### 重写（4 · stub → 真实归属）
| 文件 | 归属源 | 关键点 |
|---|---|---|
| [`lib/adapters/access/workflow.ts`](../../lib/adapters/access/workflow.ts) | `resource_permissions(resource_type='workflow')` | loadDetail 先确认 workflow 存在（404 区分）再取 scopes；checkWrite action ∈ update/enable/duplicate/delete；create 走路由 Lane A，adapter.checkCreate 仅作 facade 兜底 |
| [`lib/adapters/access/agent.ts`](../../lib/adapters/access/agent.ts) | `resource_permissions(resource_type='agent')`（与 agents GET 列表同源，**非 tenant_agents**） | suffix 仅 org/all；`checkCreate` 返 **false**（决策 D9=b：agent POST 走 legacy role-only，不经 facade） |
| [`lib/adapters/access/agent-draft.ts`](../../lib/adapters/access/agent-draft.ts) | `created_by` → `users.tenant_code` 反查 | suffix 仅 org/all；每次多查一次 users（主键索引，不加 cache） |
| [`lib/adapters/access/user.ts`](../../lib/adapters/access/user.ts) | `users.tenant_code` | suffix 仅 org/all；checkWrite 的 action 是复合 sub-action（role.update / department.assign / …，由路由按 body.action 映射）；**hierarchy（canManageTarget/canAssignRole）+ 不能改自己仍由路由兜，adapter 不接管** |

> 4 adapter 仍通过 [`index.ts`](../../lib/adapters/access/index.ts) 的 side-effect import 注册（`registerAccessAdapter` 在各文件 load 时调），resourceKind 不变（workflow/agent/agent_draft/user），REGISTRY 行为一致。

---

## 4. CI 验收

| 项 | 结果 |
|---|---|
| `npx tsx scripts/phase-d-scope-utils.test.ts` | ✅ 7/7 |
| `npm run ci:typecheck` | ✅ 0 errors |
| `npm run ci:lint` | ✅ 0 errors（仅历史 `agents/[id]/page.tsx:778` hooks-deps warning，与本次无关） |
| `npm run ci:build` | ✅ Compiled successfully |
| `npm run seed:check` | ✅ 0 diff vs v52（D-0 不动 seed） |

---

## 5. 不动 / 边界

- **路由层全不动**（requireAccess 接入是 D-1~D-5）。
- v52 migration / seed 不动；custom_admin 通道（v50 三表）不动。
- 生产 / staging `PERMISSION_V2_ENFORCE_RESOURCES` 保持空 → adapter 是死代码，行为零变化。
- 未引入测试框架依赖（tsx 脚本即测试，与 seed:check 同款）。

---

## 6. 携带到 D-1+ 的开放点（实施时确认）

1. **DB-glue 验证**：4 个重写 adapter 的 loadDetail/checkRead/checkWrite 真实行为，待 D-1 起 dev-DB `phase-d-smoke.ts` function-level 验证（dev DB 须先跑 v52）。
2. **空 scope 语义**：workflow/agent 若某资源只含 `user`/`user_type` scope 行 → 映射后 `scopes=[]` → `hasPermission(key, [])` 在 key 命中时返 true（现有 hasPermission 契约）。是否对"无 hierarchy scope"资源改 fail-closed，留 **D-3 决策**。
3. **agent 写口径分叉**：确认 publish / `agents/[id]` PATCH 写可见性也走 `resource_permissions`（不再写 `tenant_agents` 造成与 adapter 读源分叉），留 **D-2** 核对。

---

## 7. 上线策略

- **无新 migration**；本期不动 schema / seed。
- 合并：D-0 作为 Phase C R3 commit 之后的 follow-up commit 留 `feature/6.4up`。
- **仍不进既定上线包的 enforce**（生产 env 始终空）；adapter 死代码随包走、零行为变化。

---

## 8. 下一步

- 待用户 / 小B 对 D-0 ack → 进 **D-1 · user enforce**（`users` 路由按 §6 body.action 映射叠 requireAccess；dev 开 `user`；写 `phase-d-smoke.ts` user 段）。
- D-1 dev 联调前提：用户在 dev DB（`ysgdmdqygbvfthzylhqn`）确认已跑 v52（`check-phase-c-pre.ts` ✅）。

---
---

# D-1 ~ D-6 实施（同日续 · 用户拍板「现在 D1-D6 一次性做完，做完我验收」）

**审批** 用户 GO「一次性做完 D1-D6」。**红线确认**：生产 / staging `PERMISSION_V2_ENFORCE_RESOURCES` **全程保持空** → 所有新接入路由的 v2 闸第 1 行 `isResourceEnforced` 命中 false → no-op，**生产行为零变化、可整体回滚**；按子阶段分别记录 + 配套 `phase-d-smoke.ts`，用户仍可逐组 dev 验收（dev 一组组加 env CSV）。

## 统一接入范式（所有 D-1~D-5 路由一致）

- **旧闸全部保留在前**（5.30up 双闸 / canManageTarget / canActOnRole / ensureOrgAdminCanTouch / org_admin 硬拒等），v2 `requireAccess` / env-gated `hasPermission` **只叠加一道第二闸**（结构性优先）。
- **env-gated + super 短路**：每处闸均 `if (isResourceEnforced(kind) && admin.role !== "super_admin") { ... }`；super_admin 由 requireAccess 公式第 1 行放行。
- **list（GET）** 走 HC2 env-gated `hasPermission(<prefix>.read.{org,all})`（facade read 分支强制要 row，list 无 row）。
- **create（POST）** 走 `requireAccess(...,"create")` → adapter.checkCreate（双形态资源 / workflow 走 Lane A 的 OR）。
- **update/delete/子动作** 走 `requireAccess(...,{row|id})`，能复用已 load row 的就传 `{row}`（kb/provider）。
- **resourceKind ≠ prefix 防坑**：kb 路由用 `"knowledge_base"`、provider 用 `"model_provider"`（R0.1 §3.5；env CSV 同此），key 前缀仍是 `kb.*`/`provider.*`。

## D-1 · user enforce
| 文件 | 改动 |
|---|---|
| `app/api/admin/users/route.ts` | GET：env-gated `user.read.{org,all}` |
| `app/api/admin/users/[id]/route.ts` | PATCH：`USER_SUBACTION` 把 `body.action`（set-status/set-role/set-tenant/set-dept/reset-password/soft-delete\|delete）映射到 `user.<subaction>` 后叠 `requireAccess(...,{row:target})`；旧 canManageTarget/canAssignRole 保留在前（R0.1 §6 / D10=a：set-dept 收 `user.department.assign`） |
| `app/api/admin/users/bulk-set-tenant/route.ts` | POST：批量跨组织调动要求 `user.tenant.transfer.all`（org_admin 仍硬拒在前） |

## D-2 · agent + agent_draft enforce
| 文件 | 改动 |
|---|---|
| `app/api/admin/agents/route.ts` | GET：env-gated `agent.read.{org,all}`；**POST 维持 legacy role-only（决策 D9=b，不接 v2）** |
| `app/api/admin/agents/[id]/route.ts` | PATCH：改 enabled→`agent.enable`、改其它→`agent.basic.update`；DELETE→`agent.delete`（org_admin 硬拒已在前） |
| `app/api/admin/agent-drafts/route.ts` | GET：`agent_draft.read.*`；POST：`requireAccess create` |
| `app/api/admin/agent-drafts/[id]/route.ts` | GET/PATCH/DELETE → `agent_draft.{read,update,delete}`（org_admin own 校验保留在前） |
| `app/api/admin/agent-drafts/[id]/publish/route.ts` | `agent_draft.publish`（保留资源可见性校验） |
| `app/api/admin/agent-drafts/[id]/duplicate/route.ts` | `agent_draft.duplicate` **按 actor 自身能力 OR .all/.org**（不按 source scope —— source 可能是 super/system 平台模板 all-scope，用 source scope 会误拒 5.30up R4 的"org_admin 复制模板"） |
| `app/api/admin/agent-drafts/[id]/test-chat/route.ts` | `agent_draft.test` |

## D-3 · workflow enforce（builtin 路径，custom 通道零改）
- **双通道隔离（R0.1 F3）**：所有 v2 闸只插在 `!isCustomAdminPayload(access)` 的 builtin 分支；custom_admin 分支（requirePermission 语义）一字未动。
| 文件 | 改动 |
|---|---|
| `app/api/admin/workflows/route.ts` | GET builtin：`workflow.read.{org,all}`；POST builtin：`workflow.create` OR .all/.org |
| `app/api/admin/workflows/[id]/route.ts` | PATCH builtin：改 enabled→`workflow.enable`、其它→`workflow.update`；DELETE builtin：`workflow.delete`（canActOnRole + ensureOrgAdminCanTouch 保留在前） |
| `app/api/admin/workflows/[id]/steps/route.ts` | POST/PUT builtin：step 写视为 `workflow.update` |
| `app/api/admin/workflow-steps/[id]/route.ts` | PATCH/DELETE builtin：反查父 workflow → `workflow.update` |
| `app/api/admin/workflows/[id]/duplicate/route.ts` | **R0.1 越权点修复**：此路由原本只有 requireAdmin、**零结构闸**（org_admin 可复制任意 workflow）。新增：① canActOnRole 上下级；② org_admin source 归属（resource_permissions 命中本组织）；③ `workflow.duplicate` v2 闸。select 补 `created_by_role`。 |

## D-4 · tenant + dept + team enforce
| 文件 | 改动 |
|---|---|
| `app/api/admin/tenants/route.ts` `[id]/route.ts` | tenant 平台级（`.all` only）：GET 仅对 system_admin 等非 super 非 org 用 `tenant.read.all`（org_admin 无 tenant key、保持"只看本组织"旧逻辑）；POST/PATCH/DELETE→`tenant.{create,update,delete}.all`（org_admin 硬拒已在前） |
| `app/api/admin/departments/route.ts` `[id]/route.ts` | generic tenant-owned：GET `dept.read.*`；POST `requireAccess create`；PATCH/DELETE `dept.{update,delete}`（ensureOrgScope 保留在前） |
| `app/api/admin/teams/route.ts` `[id]/route.ts` | 同 dept，prefix `team.*` |

## D-5 · kb + provider enforce（高风险，含 API key 面）
- **保留 5.30up 双闸（requireWriteAccess + canReadRow/canWriteRow + sanitizeUpdatePatch）在前**，v2 只叠第二闸；写操作复用路由已 load 的 row（零额外查询）。
| 文件 | 改动 |
|---|---|
| `app/api/admin/knowledge-bases/route.ts` `[id]/route.ts` | resourceKind `knowledge_base`：GET `kb.read.*`；POST `requireAccess create`（generic checkCreate .all 兜底）；GET/PATCH/DELETE `kb.{read,update,delete}`（{row} 复用） |
| `app/api/admin/model-providers/route.ts` `[id]/route.ts` `[id]/test/route.ts` | resourceKind `model_provider`：GET `provider.read.*`；POST `provider.create`（system_admin 已被白名单排除）；GET/PATCH/DELETE `provider.{read,update,delete}`；test → `provider.test` OR .all/.org |
| kb `[id]/documents/**` | **本期不单接**：文档读写已被父 KB 的 canReadRow/canWriteRow 结构性兜（属父 KB 访问面）；KB-content 级 v2 enforce 留 follow-up（见开放点） |

## D-6 · F 收口
- **`ci:test` 接真测**：`package.json` `ci:test` 从 echo 占位改为 `tsx scripts/phase-d-scope-utils.test.ts && npm run seed:check` → `ci:check` 现在真正覆盖 adapter 纯逻辑单测 + seed 与 v52 一致性。
- **全仓 `?? "super_admin"` 二扫完成**：18 处命中（agents / login / change-password / me / workflows*/duplicate/steps / workflow-steps）**全部在 builtin-only 路径或 builtin 分支**；`/api/admin/me:49` 经确认在 `isCustomAdminPayload` 早返之后的 builtin 分支（custom_admin 在 line 28 返回 `role:null`/`builtinRole:null`，不达 line 49）。**无 custom-admin 可达的超管兜底，无需删除**（R0.1 §8.2：builtin-only 历史兜底位于 requireAdmin 之后可保留）。
- **admin-layout（决策 D4=b）**：`settings` / `permissions` 菜单维持 `SUPER_ONLY` 硬锁（现状已是，确认不回退）；菜单 `requiredPermission` 体验层留 follow-up，不阻塞收口（后端 requireAccess 才是真边界）。
- **canActOnRole（决策 D7=a）**：保留。真实调用点 3 处（workflows/[id]:60、steps:117/202、workflow-steps:54）均在各自路由 v2 `requireAccess` 之前 / fail-closed 并存，未删。

## 新增脚本
- `scripts/phase-d-smoke.ts`：dev-DB function-level smoke。A 类数据无关（fail-closed builtinRole=null 拒 / custom_admin 对 admin-only key 拒 / scope 映射过滤）；B 类数据相关（generic checkCreate .all 修复 / 4 adapter loadDetail 不再 404），缺 v52 或样本行则 SKIP。**用户在 dev DB 跑**（会临时 INSERT/DELETE sys admin + override，自清理）。小A 本机未跑（遵守不擅动 DB）。

## CI（D-1~D-6 全量）
| 项 | 结果 |
|---|---|
| `npm run ci:typecheck` | ✅ 0 errors |
| `npm run ci:lint` | ✅ 0 errors（仅历史 `agents/[id]/page.tsx:778` warning） |
| `npm run ci:build` | ✅ Compiled successfully |
| `npm run ci:test`（= scope-utils 单测 + seed:check） | ✅ 7/7 + seed 0 diff |

## 携带到 dev 联调 / 验收的开放点
1. **DB-glue 真值**：所有路由 v2 闸 + 4 adapter 的真实判定，待用户在 dev DB（v52 已跑）逐组开 env CSV 跑 `phase-d-smoke.ts` + 实际 UI 操作验收（红线：逐组验，不一次全开）。
2. **空 scope 语义**（R0.1 携带项）：workflow/agent 仅含 `user`/`user_type` scope 行 → 映射后 `scopes=[]` → `hasPermission(key,[])` 在 key 命中时返 true。是否对"无 hierarchy scope"资源改 fail-closed，**留决策**（影响面：自定义可见性 workflow/agent 的 builtin 写）。
3. **agent 写口径分叉**：确认 publish / agents/[id] PATCH 写可见性走 `resource_permissions`（agent adapter 读源），不再写 `tenant_agents` 造成分叉 —— 待 dev 核对。
4. **kb documents 子路由**：本期靠父 KB 结构性兜；如需 KB-content 级独立 enforce，follow-up。

## D-3 Fix · workflow duplicate 同步复制 resource_permissions（小B 复审 P1）

**问题（小B 复审抓出，已核实）**：[workflows/[id]/duplicate/route.ts](../../app/api/admin/workflows/[id]/duplicate/route.ts) 原本复制 workflow + steps + categories，**漏了 `resource_permissions`** → 副本零归属行。

后果分两层：
1. **当下即坏（与 enforce 无关）**：[workflows/route.ts:131-162](../../app/api/admin/workflows/route.ts) 的 org_admin 列表按 `resource_permissions` 命中本组织过滤（5.9up 既有逻辑、**不受 enforce 开关控制**）。副本零行 → 不在 `scopedWfIds` → **org_admin 复制完刷新即看不见自己的副本**。production 当下已存在的潜伏 bug，非 Phase D 引入。
2. **开 `workflow` enforce 后更坏**：副本读写判定走 workflow adapter 反查 `resource_permissions`，零行 → `scopes=[]` → org_admin/custom 连自己的副本都判不到归属。

> 纠正小B 措辞：`super/system` 列表 `scopedWfIds=null`（不过滤），**他们的副本不会"消失"**；"消失"是 org_admin 专属症状。权限行仍需补（给未来 enforce 兜底）。

**修复（TDD，纯函数 + 薄胶水，范围仅 duplicate）**：
| 文件 | 改动 |
|---|---|
| `lib/adapters/access/_scope-utils.ts` | 新增纯函数 `selectDuplicatePermRows(srcRows, {role, tenantCode, orgDeptIds, orgTeamIds})`：super/system **原样克隆全部** scope 行（精确复制源可见性，含 all/user/user_type）；org_admin **只归一到本组织** org(==tenantCode)/dept(∈orgDeptIds)/team(∈orgTeamIds)，其余丢弃。不碰 db（dept/team 集由调用方传入）。 |
| `scripts/phase-d-scope-utils.test.ts` | 先 RED 后 GREEN，加 4 断言：super/system 全克隆、org_admin 归一本组织、org row tenantCode 不符则丢。 |
| `app/api/admin/workflows/[id]/duplicate/route.ts` | ① hoist org_admin 的 dept/team 归属查询到守卫前，**守卫与复制共用一次查询**；② insert 副本后查源 `resource_permissions` → 过 `selectDuplicatePermRows` → 批量 insert 到副本 id。 |

**CI**：`ci:check` 全绿 —— typecheck 0 error、lint 0 error（仅历史 778 warning）、build Compiled successfully、`ci:test` **11/11**（scope-utils 7→11）+ seed 0 diff。

**待用户验收**：dev UI smoke —— org_admin 复制一个本组织工作流，刷新后副本仍在列表（修复前会消失）。`phase-d-smoke.ts` 自动化 B3（org_admin duplicate）本次按用户决定**未加**（避免往 dev DB 多写 workflow）。

**未纳入本刀的非阻塞尾巴**：agent PATCH 仍保留旧 `tenantCodes → tenant_agents` 分支（前端主路径不用）。与本 P1 独立，建议真开 `agent` enforce 前单独清掉/改投 `resource_permissions`（即开放点 #3）。

## 上线策略（不变）
- 无新 migration / 不动 v52 seed / custom_admin 通道不动。
- D-0~D-6 作为 `feature/6.4up` 的 follow-up commits；生产 env 始终空 → 随包上线零行为变化；enforce 真正打开是后续运营动作（决策 D8）。
- **D-3 Fix 同样无 migration、生产零行为变化**（仅 duplicate 写入时多 insert 几行 resource_permissions，纠正既有数据缺失）。
