# 智能体舱（Agent-01）Bug 审查报告

**审查日期**：2026-04-16  
**审查范围**：全部源代码（前端页面、API 路由、lib 库、数据库 schema、适配器层）  
**发现 Bug 总计**：24 个（严重 5 / 高危 8 / 中危 8 / 低危 3）

---

## 一、严重（CRITICAL）— 必须立即修复

### ✅ Bug 1：中间件文件命名错误，路由保护完全失效

| 项目 | 内容 |
|------|------|
| **文件** | `proxy.ts` |
| **问题** | 文件名为 `proxy.ts`，但 Next.js 要求中间件文件必须命名为 `middleware.ts` 并导出默认函数。当前 `proxy` 函数永远不会被 Next.js 自动执行。 |
| **影响** | 所有受保护的路由（`/admin/*`、`/agents`、`/settings` 等）实际上没有任何鉴权保护，任何人都可以直接访问管理后台页面。 |
| **修复** | `proxy.ts` → `middleware.ts`，函数名 `proxy` → `middleware`。 |

---

### ✅ Bug 2：`getActiveAdmin()` 中 role 为空时默认赋予 super_admin 权限

| 项目 | 内容 |
|------|------|
| **文件** | `lib/session.ts` 约第 51 行 |
| **代码** | `role: (dbAdmin.role as AdminRole) ?? "super_admin"` |
| **问题** | 如果数据库中 `role` 字段为 `null` 或 `undefined`，会默认回退为 `"super_admin"` —— 最高权限角色。 |
| **影响** | 数据库异常或字段为空时，任意管理员自动获得超级管理员权限。 |
| **修复** | role 为空或不在合法列表内时直接返回 `null`（拒绝访问）。 |

---

### ✅ Bug 3：SSE 流读取器（Reader）异常时未关闭，存在资源泄漏

| 项目 | 内容 |
|------|------|
| **文件** | `lib/adapters/index.ts`（`parseSSEStream` 函数） |
| **问题** | `res.body.getReader()` 创建了读取器，但没有用 `try/finally` 包裹来确保异常时调用 `reader.cancel()`。 |
| **影响** | 高并发场景下连接池被耗尽，导致 "too many open connections" 错误。 |
| **修复** | 用 `try/finally` 包裹读取循环，`finally` 中调用 `reader.cancel()`。 |

---

### ✅ Bug 4：配额扣减 RPC 函数存在竞态条件且无返回值

| 项目 | 内容 |
|------|------|
| **文件** | `supabase/rpc.sql` 第 4-11 行 |
| **代码** | `UPDATE tenants SET quota_used = quota_used + 1 WHERE code = p_code AND quota_used < quota;` |
| **问题一** | 两个并发请求可能同时通过 `quota_used < quota` 检查，导致配额超限。 |
| **问题二** | 函数返回 `void`，调用方无法知道扣减是否成功（匹配 0 行时静默失败）。 |
| **修复** | 改为返回 `boolean`，用 `GET DIAGNOSTICS` 检查受影响行数。需在 Supabase SQL Editor 执行。 |

---

### ✅ Bug 5：管理员公告的 PATCH/DELETE 接口缺少组织级权限校验

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/admin/notices/[id]/route.ts` |
| **问题** | `org_admin` 可以修改或删除**任何组织**甚至**全局**公告，没有校验当前管理员是否有权操作目标公告。POST 接口有校验，但 PATCH/DELETE 没有。 |
| **影响** | 权限提升 —— 组织管理员可以篡改或删除不属于自己组织的公告。 |
| **修复** | PATCH/DELETE 前先查公告 `tenant_code`，`org_admin` 只能操作自己组织的公告；PATCH 时禁止 `org_admin` 修改 `tenantCode` 字段。 |

---

## 二、高危（HIGH）

### ✅ Bug 6：XSS 漏洞 — 聊天消息使用 `dangerouslySetInnerHTML` 渲染

| 项目 | 内容 |
|------|------|
| **文件** | `app/agents/[id]/page.tsx` 约第 452 行 |
| **问题** | 用正则做简单 Markdown 替换后直接用 `dangerouslySetInnerHTML` 渲染，没有任何 HTML 转义或消毒处理。 |
| **影响** | 如果 AI 后端返回恶意内容（或被注入），可以在用户浏览器中执行任意 JavaScript。 |
| **修复** | 添加 `escapeHtml` 函数，在正则替换前先转义所有 HTML 特殊字符。 |

---

### ✅ Bug 7：管理员登录不校验租户是否过期/禁用

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/admin/login/route.ts` 约第 78-92 行 |
| **问题** | 用户登录会检查租户是否启用和过期，但管理员登录（通过 users 表的 `org_admin`）完全没有这个校验。 |
| **影响** | 过期组织的 `org_admin` 仍然可以登录管理后台。 |
| **修复** | `org_admin` 登录时查 tenants 表校验 `enabled` 和 `expires_at`。 |

---

### ✅ Bug 8：多个适配器中先调用 `res.text()` 再读取 `res.body`

| 项目 | 内容 |
|------|------|
| **文件** | `lib/adapters/index.ts` 多处（Coze、Dify、Yuanqi） |
| **问题** | 在 `!res.ok` 分支中调用 `await res.text()` 消费了 body，之后 `parseSSEStream(res, ...)` 又尝试读取同一个 body。 |
| **影响** | 虽然当前 throw 后不会走到后面，但属于脆弱模式。 |
| **修复** | 三处 `res.text()` → `res.clone().text()`。 |

---

### ✅ Bug 9：注册接口存在 TOCTOU 竞态条件

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/auth/register/route.ts` 约第 84-90 行 |
| **问题** | 先查询用户名是否存在，再插入。两个并发请求可能都通过检查，导致重复注册。 |
| **影响** | 取决于数据库是否有唯一约束 —— 如果没有，会创建重复用户。 |
| **修复** | 数据库已有 `username` UNIQUE 约束，在 insert 错误处理中识别 `23505`（唯一约束冲突）返回友好提示。 |

---

### ✅ Bug 10：API Key 以明文存储

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/admin/agents/route.ts` 约第 89 行 |
| **代码** | `api_key_enc: apiKey ?? ""` |
| **问题** | 字段名叫 `api_key_enc`（暗示加密），但实际存储的是明文 API Key。 |
| **修复** | 新建 `lib/crypto.ts`（AES-256-GCM，密钥从 JWT_SECRET 派生），写入 4 处加 `encrypt()`，读取 2 处加 `decrypt()`，兼容旧明文数据。 |

---

### ⏭️ Bug 11：用户自定义智能体创建后响应泄漏原始 API Key

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/user-agents/route.ts` 约第 45 行 |
| **问题** | POST 创建成功后，响应 JSON 中包含完整的 `api_key_enc` 字段原始值。 |
| **状态** | **无需修复** — 实际代码中 `.select()` 没有包含 `api_key_enc` 字段，响应里已经不含该字段，不存在泄漏。 |

---

### ✅ Bug 12：权限查询加载全表数据到内存

| 项目 | 内容 |
|------|------|
| **文件** | `lib/permissions.ts` 约第 40-44 行 |
| **代码** | `const { data: allPerms } = await db.from("resource_permissions").select(...)` |
| **问题** | 不带任何 WHERE 条件，每次请求都加载 `resource_permissions` 全表到内存中再过滤。 |
| **影响** | 权限数据增长后严重影响性能，可能导致内存溢出。 |
| **修复** | 用 `.or()` 构建服务端过滤条件，只拉取匹配当前用户的权限行，删除内存中的 `matchesUser` 函数。 |

---

### ✅ Bug 13：首次登录密码策略不一致

| 项目 | 内容 |
|------|------|
| **文件** | `components/ui/first-login-modal.tsx` 第 22 行 |
| **问题** | 首次登录修改密码只要求 **6 位**，但注册页面和设置页面要求 **8 位**。 |
| **影响** | 用户可在首次登录时设置不符合安全策略的弱密码。 |
| **修复** | `< 6` → `< 8`，placeholder 文字同步修改。 |

---

## 三、中危（MEDIUM）

### ✅ Bug 14：`tenant_agents` 表缺少外键约束

| 项目 | 内容 |
|------|------|
| **文件** | `supabase/schema.sql` 约第 66-70 行 |
| **问题** | `tenant_agents.tenant_code` 是 TEXT 类型，没有外键关联到 `tenants.code`。删除租户后，关联记录成为孤儿数据。 |
| **修复** | schema.sql 加 `REFERENCES tenants(code) ON DELETE CASCADE`，migration_v17.sql 清理孤儿数据并加外键。需在 Supabase SQL Editor 执行。 |

---

### ✅ Bug 15：清言（Qingyan）Token 缓存无大小限制，存在内存泄漏

| 项目 | 内容 |
|------|------|
| **文件** | `lib/adapters/index.ts` 约第 227-246 行 |
| **问题** | `qingyanTokenCache` 是一个无上限的 `Map`，token 只增不减。 |
| **影响** | 长时间运行的服务进程中，缓存会持续增长，导致内存泄漏。 |
| **修复** | 每次 `set` 新 token 前遍历清理过期条目。 |

---

### ⏭️ Bug 16：登录频率限制可通过大小写绕过

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/auth/login/route.ts` 约第 25 行 |
| **问题** | rate limit key 使用 `identifier.toLowerCase()`，但如果在 `toLowerCase()` 之前就调用了 `checkLoginRate`，则大小写不同的输入会命中不同的限流桶。 |
| **状态** | **无需修复** — 实际代码第 25 行 `rateKey = \`user:${identifier.toLowerCase()}\`` 在 `checkLoginRate` 之前就已完成 `toLowerCase()`，不存在绕过问题。 |

---

### ✅ Bug 17：Cookie 未设置 `Secure` 标志

| 项目 | 内容 |
|------|------|
| **文件** | `lib/auth.ts` 约第 135-148 行 |
| **问题** | `Set-Cookie` 头没有 `Secure` 标志，在 HTTP 环境下 cookie 会以明文传输。 |
| **修复** | 根据 `NODE_ENV === "production"` 自动追加 `; Secure`，开发环境不加。 |

---

### ✅ Bug 18：管理员创建/更新租户时未校验 quota 和 expires_at

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/admin/tenants/[id]/route.ts` 约第 17-18 行 |
| **问题** | `quota` 直接 `Number()` 转换，不校验是否为负数、`NaN` 或不合理的大数值。`expires_at` 不校验是否为合法的未来日期。 |
| **修复** | `quota` 校验 0~10,000,000 整数，`expires_at` 校验日期格式合法性。 |

---

### ⏭️ Bug 19：元气（Yuanqi）适配器丢失多轮对话上下文

| 项目 | 内容 |
|------|------|
| **文件** | `lib/adapters/index.ts` 约第 261-263 行 |
| **问题** | Yuanqi 适配器只取最后一条用户消息发送，丢弃了全部历史对话。 |
| **状态** | **无需修复** — 报告描述有误。Yuanqi 适配器（第 151 行）传入了全部历史消息。报告混淆了 Yuanqi（元气）和 Qingyan（清言），清言只发最后一条 prompt 是正确的（通过 `conversation_id` 由平台管理上下文）。 |

---

### ✅ Bug 20：文件上传未校验文件编码

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/upload/route.ts` 约第 99-100 行 |
| **问题** | txt/csv 文件直接按 UTF-8 解码，不处理 GBK 等其他中文编码。 |
| **影响** | 非 UTF-8 编码的文件会产生乱码。 |
| **修复** | 检测 BOM → UTF-8 试解（检查替换字符）→ 回退 GBK，不引新依赖。 |

---

### ✅ Bug 21：语音接口文件删除失败时静默忽略

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/speech/route.ts` 约第 139-142 行 |
| **代码** | `.remove([audioPath]).catch(() => {})` |
| **问题** | 删除失败完全静默，不记录日志，导致存储空间泄漏且无法排查。 |
| **修复** | `.catch(() => {})` → `.catch((err) => console.error(...))`。 |

---

## 四、低危（LOW）

### ✅ Bug 22：`logs` 表缺少常用查询字段的索引

| 项目 | 内容 |
|------|------|
| **文件** | `supabase/schema.sql` 约第 102-106 行 |
| **问题** | `logs` 表只有 `created_at` 和 `tenant_code` 索引，缺少 `agent_code`、`user_phone` 等字段的索引。 |
| **影响** | 管理后台按智能体或用户查询日志时会全表扫描，数据量大时性能差。 |
| **修复** | schema.sql 和 migration_v18.sql 添加 `agent_code`、`user_phone`、`action` 三个索引。需在 Supabase SQL Editor 执行。 |

---

### ⏭️ Bug 23：分类排序存在并发竞态

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/admin/categories/route.ts` 约第 22-23 行 |
| **问题** | 先查 `max(sort_order)` 再 +1 插入，两个并发请求会拿到相同的排序值。 |
| **状态** | **暂不修复** — `sort_order` 无 UNIQUE 约束，重复不报错，最差结果是两个分类排序值相同、顺序随机，管理员手动拖拽即可调整，风险极低。 |

---

### ⏭️ Bug 24：Agent 列表硬编码 `limit(1000)`，无分页

| 项目 | 内容 |
|------|------|
| **文件** | `app/api/agents/route.ts` 约第 38 行 |
| **问题** | 超过 1000 个智能体时数据被静默截断，用户无感知。 |
| **状态** | **暂不修复** — 当前是首页卡片式全量展示，加分页需前后端联动改造。实际场景下单租户智能体很少超过 100 个，1000 上限足够。后续如有需求再迭代。 |

---

## 修复优先级建议

### 第一优先级（立即修复）
1. ✅ **Bug 1** — 中间件命名（路由保护完全失效）
2. ✅ **Bug 2** — super_admin 默认角色（权限最大化漏洞）
3. ✅ **Bug 6** — XSS 漏洞（可执行任意 JS）

### 第二优先级（尽快修复）
4. ✅ **Bug 3** — 流读取器资源泄漏
5. ✅ **Bug 4** — 配额竞态条件
6. ✅ **Bug 5** — 公告越权操作
7. ✅ **Bug 7** — 管理员登录绕过租户校验
8. ✅ **Bug 10** — API Key 明文存储
9. ⏭️ **Bug 11** — API Key 响应泄漏（实际不存在）

### 第三优先级（版本迭代中修复）
10. ✅ 其余中危和低危 Bug（大部分已修复）

---

## 总结表

| 严重程度 | 数量 | 已修复 | 无需修复 | 暂不修复 |
|---------|------|--------|---------|---------|
| **严重 (CRITICAL)** | 5 | 5 | 0 | 0 |
| **高危 (HIGH)** | 8 | 7 | 1 | 0 |
| **中危 (MEDIUM)** | 8 | 5 | 2 | 0 |
| **低危 (LOW)** | 3 | 1 | 0 | 2 |
| **合计** | **24** | **18** | **3** | **2** |

### 需要在 Supabase SQL Editor 执行的迁移
- **Bug 4**：`rpc.sql` — DROP + CREATE 配额扣减函数（已执行）
- **Bug 14**：`migration_v17.sql` — tenant_agents 外键约束（已执行）
- **Bug 22**：`migration_v18.sql` — logs 表索引（待执行）
