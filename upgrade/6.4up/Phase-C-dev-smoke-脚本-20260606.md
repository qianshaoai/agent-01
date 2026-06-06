# Phase C · dev enforce smoke 点击脚本

| 字段 | 值 |
|---|---|
| 状态 | R0 · 2026-06-06 小A 出，待用户照点 |
| 分支 | `feature/6.4up`（本地，不推 origin） |
| HEAD | `8ede5f5 fix(6.4up v2 Phase C R1): notice POST 双形态分支修复` |
| 适用 DB | dev Supabase `ysgdmdqygbvfthzylhqn`（独立） |
| 适用 env | **dev only**。staging / prod 的 `PERMISSION_V2_ENFORCE_RESOURCES` 必须保持空 |
| 列脚本 | 小A |
| 执行 | 用户 |
| 验收 | 小B |
| 总耗时预估 | ~ 50 min |

---

## 0 · 前置（~ 5 min）

### 0.1 ENV 安全锁
- [ ] 当前打开的是 `agent-01/.env.local`（dev），**不是** Vercel 后台
- [ ] Vercel staging / prod 的 `PERMISSION_V2_ENFORCE_RESOURCES` 仍是空 / 未设（不去改）

### 0.2 baseline 数据库状态
- [ ] 在 `agent-01/` 目录跑 `npx tsx scripts/check-phase-c-pre.ts`
  - 预期：`✅ 可直接开 enforce 联调`；`system_admin=109`、`org_admin=64`、`admin_permission_overrides=0`、`builtin_role_permissions` 存在
- [ ] 浏览器登录 super → `/admin/permissions?tab=personal` 打开正常，每个 admin 的"覆盖数"列都是 0

### 0.3 三个测试账号（你确认或新建）
| 角色 | 用途 | tenantCode |
|---|---|---|
| `super` 一名 | 改 override / 看跨组织数据 | 无 |
| `sys` 一名（system_admin） | **测全局公告路径（R1 关键路径）** | **必须无 tenantCode** |
| `org-DEMO` 一名（org_admin） | 测组织级路径 | `DEMO`（或你指定的任意组织） |

- [ ] 三个账号已就位，密码/登录方式确认

### 0.4 env 起点
- [ ] `.env.local` 当前**不含** `PERMISSION_V2_ENFORCE_RESOURCES` 那一行（或值为空）
- [ ] `next dev` 当前是空 env 状态（开着也行，等会儿要重启）

---

## Stage 1 · enforce = `notice,category`

### 1.0 启用
1. [ ] `.env.local` 末尾加一行：`PERMISSION_V2_ENFORCE_RESOURCES=notice,category`
2. [ ] 完全停掉 `next dev`，重新 `npm run dev`（按项目惯例可能要 `--webpack` fallback）
3. [ ] 烟测：super 登录 → `/admin/notices` 列表能打开（200）

### 1.1 notice 创建 · baseline（无 override）

| # | 角色 | 操作 | 预期 | 必做恢复 |
|---|---|---|---|---|
| 1 | super | `/admin/notices` 新建公告，**不选**组织（全局） | 201；列表里出现 `tenant_code=null` | 删该条公告 |
| 2 | super | 新建公告，组织选 `DEMO` | 201；`tenant_code=DEMO` | 删该条 |
| 3 | **sys** | 新建公告，**不选**组织（**R1 关键路径**） | **201；`tenant_code=null`**（修复前会 403） | 删该条 |
| 4 | sys | 新建公告，组织选 `DEMO` | 201；`tenant_code=DEMO` | 删该条 |
| 5 | org-DEMO | 新建公告，组织字段填 `ABC`（任意非自己） | 201，但写入后 `tenant_code=DEMO`（业务转换强制覆盖） | 删该条 |

恢复确认：
- [ ] `/admin/notices` 翻一遍，测试公告全删掉

### 1.2 notice 列表（GET）

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 6 | sys | `/admin/notices` 列表 | 200，能看全部 |
| 7 | org-DEMO | 列表 | 200，只看到 DEMO 的 + 全局公告 |

（GET 不写数据，无恢复）

### 1.3 notice override · 撤销 sys 的 `notice.create.all`

设置：
1. [ ] super 登录 → `/admin/permissions?tab=personal` → 选 sys
2. [ ] 找到 `notice.create.all` 那一格，点成"revoke"（红色）
3. [ ] 保存（PUT）→ 顶部出现"已保存"提示

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 8 | sys | 新建全局公告（不选组织） | **403 `权限不足`** |
| 9 | sys | 新建 DEMO 公告（`notice.create.org` 还在） | 201 |

**必做恢复**（顺序勿乱）：
1. [ ] 删 9 创建的测试公告
2. [ ] super → `/admin/permissions?tab=personal` → sys → `notice.create.all` 改回 default（白色）
3. [ ] 保存 PUT
4. [ ] SQL：`select count(*) from admin_permission_overrides where admin_id = '<sys 的 id>'` → 0

### 1.4 notice override · 撤销 org-DEMO 的 `notice.create.org`

设置：
1. [ ] super → `/admin/permissions?tab=personal` → 选 org-DEMO
2. [ ] `notice.create.org` 那一格 → revoke
3. [ ] 保存

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 10 | org-DEMO | 新建公告（任意组织） | **403 `权限不足`** |

**必做恢复**：
1. [ ] super → 同路径 → `notice.create.org` 改回 default
2. [ ] 保存
3. [ ] SQL：`select count(*) from admin_permission_overrides` → 0

### 1.5 category baseline

| # | 角色 | 操作 | 预期 | 必做恢复 |
|---|---|---|---|---|
| 11 | super | `/admin/categories` 新建分类 `Smoke-X` | 201 | （留到 17 删） |
| 12 | super | 编辑 `Smoke-X`，改个名 | 200 | （后面要用） |
| 13 | super | 给 `Smoke-X` 上传一张图标 | 200，icon_url 返回 | （14 步会清） |
| 14 | super | 删除 `Smoke-X` 的图标 | 200，icon_url=null | — |
| 15 | sys | 新建分类 `Smoke-Y` | 201（sys 有 `category.create.all`） | （17 步会删） |
| 16 | org-DEMO | 尝试新建分类 | **403 `无权操作`**（旧闸 + v52 都不给 org_admin）| — |
| 17 | super | 删除 `Smoke-X` 和 `Smoke-Y` | 200 | — |

恢复确认：
- [ ] `/admin/categories` 翻一遍，无 `Smoke-*` 残留

### 1.6 category override · 撤销 sys 的 `category.create.all`

设置：
1. [ ] super → `/admin/permissions?tab=personal` → sys → `category.create.all` → revoke
2. [ ] 保存

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 18 | sys | 新建分类 `Smoke-Z` | **403** |

**必做恢复**：
1. [ ] revert override（改回 default）
2. [ ] 保存
3. [ ] SQL：`select count(*) from admin_permission_overrides` → 0

### 1.7 Stage 1 复位检查（强制）
- [ ] SQL：`select count(*) from admin_permission_overrides` → **0**
- [ ] `/admin/permissions?tab=personal` 翻一遍，每行覆盖数都是 0
- [ ] `/admin/notices` 无测试残留
- [ ] `/admin/categories` 无 `Smoke-*` 残留

---

## Stage 2 · enforce = `notice,category,analytics,audit`

### 2.0 切换
1. [ ] `.env.local` 改为：`PERMISSION_V2_ENFORCE_RESOURCES=notice,category,analytics,audit`
2. [ ] 重启 `next dev`
3. [ ] 烟测：super → `/admin/analytics` 能打开（200）

### 2.1 analytics baseline（HC1：复用 `audit.read.*` 钥匙）

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 19 | super | `/admin/analytics` | 200，能看跨组织数据 |
| 20 | sys | `/admin/analytics` | 200（有 `audit.read.all`） |
| 21 | org-DEMO | `/admin/analytics` | 200，**数据自动过滤到 DEMO**（页面 totalTenants=1） |

（GET，无恢复）

### 2.2 audit-logs baseline

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 22 | super | `/admin/audit-logs` | 200，看全 |
| 23 | sys | `/admin/audit-logs` | 200，看全 |
| 24 | org-DEMO | `/admin/audit-logs` | 200，过滤到 admin_tenant_code 或 resource_tenant_code 为 DEMO 的记录 |

### 2.3 一次 override 覆两个路由（HC1 复用证明）

设置：
1. [ ] super → `/admin/permissions?tab=personal` → sys → `audit.read.all` → revoke
2. [ ] 保存

| # | 角色 | 操作 | 预期 |
|---|---|---|---|
| 25 | sys | `/admin/audit-logs` | **403** |
| 26 | sys | `/admin/analytics` | **403**（同一个 key 把 analytics 也关掉，证明 HC1 复用对了） |

**必做恢复**：
1. [ ] revert override
2. [ ] 保存
3. [ ] SQL：`select count(*) from admin_permission_overrides` → 0

---

## 3 · 收尾（强制，~ 5 min）

### 3.1 关 enforce（最重要的一步）
1. [ ] `.env.local` 删掉 `PERMISSION_V2_ENFORCE_RESOURCES=...` 这一行（**整行删，不要只置空**，避免下次看不见）
2. [ ] 重启 `next dev`
3. [ ] 烟测：super → `/admin/notices` 列表正常（行为应该和 Phase C 之前完全一致）

### 3.2 终态三连
- [ ] `npx tsx scripts/check-phase-c-pre.ts` → `✅`；`system_admin=109`、`org_admin=64`、`overrides=0`
- [ ] SQL 双保险：`select count(*) from admin_permission_overrides` → **0**
- [ ] `/admin/notices` / `/admin/categories` 无任何 `Smoke-` / 测试公告残留

### 3.3 git 检查
- [ ] `git status` 干净（`.env.local` 在 `.gitignore` 里，不会进暂存）
- [ ] HEAD 仍是 `8ede5f5`，没有意外提交

---

## 4 · 结果回填模板（贴回 `变更记录-20260606-permission-v2-phase-c.md`）

把这段贴到该文档末尾，每行填 ✅ / ❌（带状态码）：

```markdown
### dev smoke 实测（R2 收尾）· 2026-06-06

执行：用户；DB：dev `ysgdmdqygbvfthzylhqn`；enforce 顺序：notice,category → +analytics,audit

| # | 路径 | 结果 |
|---|---|---|
| 1 | super POST 全局 notice | ☐ |
| 2 | super POST DEMO notice | ☐ |
| 3 | **sys POST 全局 notice（R1 关键）** | ☐ |
| 4 | sys POST DEMO notice | ☐ |
| 5 | org-DEMO POST → 强制覆盖为 DEMO | ☐ |
| 6 | sys GET 列表 | ☐ |
| 7 | org-DEMO GET 列表 | ☐ |
| 8 | sys revoke create.all → POST 全局 → 403 | ☐ |
| 9 | sys revoke create.all → POST DEMO → 201 | ☐ |
| 10 | org-DEMO revoke create.org → POST → 403 | ☐ |
| 11-14 | super category CRUD + icon | ☐ |
| 15 | sys POST category | ☐ |
| 16 | org-DEMO POST category → 403 | ☐ |
| 17 | super DELETE category | ☐ |
| 18 | sys revoke category.create.all → POST → 403 | ☐ |
| 19 | super GET analytics | ☐ |
| 20 | sys GET analytics | ☐ |
| 21 | **org-DEMO GET analytics → DEMO 过滤** | ☐ |
| 22-24 | audit-logs 三角色 | ☐ |
| 25 | sys revoke audit.read.all → audit-logs → 403 | ☐ |
| 26 | **同一 revoke → analytics → 403（HC1 复用证明）** | ☐ |

终态：`check-phase-c-pre.ts` ✅；overrides=0；env 已清空；测试数据无残留。
```

行 **3 / 21 / 26** 是这一轮 R1+HC1 的关键证明点。全 ✅ 才能让小B 关 Phase C，进 Phase D R0。

---

## 5 · 异常手册

### 5.1 行 3（sys 创全局公告）返回 403
- R1 修复点没生效。立刻：
  1. `.env.local` 删掉那行
  2. 重启 next dev
  3. 通知小A debug；不要继续后面的测试

### 5.2 行 21（org-DEMO analytics）返回 200 但显示了别人组织数据
- HC1 的 actor.tenantCode 注入或 hasPermission 判断有 bug
- 同上：关 enforce、停测、通知小A

### 5.3 某一步 403 但你以为应该过
- 检查 `.env.local` 行内有没有拼写错误（如 `notice ,category` 多了空格 → 字符串不匹配）
- 检查浏览器是否登错账号（顶部账号名）
- 检查 cookie / 是否需要清 `.next` 缓存重启

### 5.4 测试结束后 SQL 发现 `admin_permission_overrides` 仍有记录
1. SQL：`select admin_id, permission_key, effect from admin_permission_overrides`
2. 用 `/admin/permissions?tab=personal` UI 还原；或如 UI 卡住，SQL 直接 `delete from admin_permission_overrides where admin_id in (...)`
3. 重跑 `check-phase-c-pre.ts` 确认 0

### 5.5 staging / prod env 被误开（最坏情况）
- 立即去 Vercel → 项目 → Settings → Environment Variables → 删除 `PERMISSION_V2_ENFORCE_RESOURCES`
- 触发重部署
- 通知用户 + 小B

---

## 6 · 范围说明（不测什么）

- **Tab 2 默认包编辑**：本脚本不动。Phase B 验收时已测过；动一次就要走全套 `confirmBeforeHash + confirmAffectedCount` 双保险，且默认包错改后果较重，留给 Phase B 后续单测
- **Tab 3 自定义角色**：旧链路，Phase C 没改它
- **Tab 4 审计**：已在行 22-24 间接覆盖
- **批量 override** / **大规模权限编辑**：Phase D 之后再压测
- **生产 / staging 任何行为**：本脚本一行都不动
