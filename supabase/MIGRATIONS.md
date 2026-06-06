# Supabase Migration 索引

每次改 DB 都新建一个文件，**不动旧文件**。这里记录所有变更，跑过哪条自己打勾。

跑法：在 Supabase Dashboard > SQL Editor 粘贴对应文件内容执行。

---

## 基础

| 文件 | 用途 | 跑过 |
| --- | --- | --- |
| `schema.sql` | 全表初始化（admins / categories / agents / tenants / users / conversations / messages / notices / logs / files） | ✅ 部署即跑 |
| `rpc.sql` | 扣额度 RPC 函数 `decrement_quota` | ✅ 部署即跑 |

## 累积迁移（按版本号）

| 文件 | 主要内容 | 跑过 |
| --- | --- | --- |
| `migration_v2.sql` | 新增外链型智能体 + 工作流主体表（workflows / workflow_steps）+ agent_type/external_url 列 | ☐ |
| `migration_v3.sql` | 工作流-分类关联表 workflow_categories | ☐ |
| `migration_v4.sql` | system_settings + category_agent_display + user_agents 三张表 | ☐ |
| `migration_v5.sql` | users 加 nickname / status / last_login_at | ☐ |
| `migration_v6.sql` | user_agents 加 platform_conv_id（清言上下文追踪） | ☐ |
| `migration_v7.sql` | users 加 user_type / role / username / real_name；新增 departments / teams 表 | ☐ |
| `migration_v8.sql` | 统一 resource_permissions 表（替代旧 tenant_agents 可见性） | ☐ |
| `migration_v9.sql` | workflow_steps.exec_type 扩到 4 值（agent / manual / review / external） | ☐ |
| `migration_v10.sql` | 联系二维码配置 | ☐ |
| `migration_v11.sql` | 独立工作流分类表 wf_categories | ☐ |
| `migration_v12.sql` | 用户分组表 user_groups | ☐ |
| `migration_v13.sql` | 补 teams.tenant_code 列（v7 漏的） | ☐ |
| `migration_v14.sql` | admins 加 role 列（super_admin / system_admin / org_admin） | ☐ |
| `migration_v15.sql` | 分类图标 + 智能体多分类（agent_categories 多对多） | ☐ |
| `migration_v16.sql` | workflows.visible_to 的逗号分隔租户码迁移到 resource_permissions | ☐ |
| `migration_v17.sql` | tenant_agents.tenant_code 加外键约束（清孤儿数据） | ☐ |
| `migration_v18.sql` | logs 表加高频查询索引 | ☐ |
| `migration_v19.sql` | users / agents / conversations 一批高频查询索引 | ☐ |
| `migration_v21.sql` | 删除用户复用账号字段（status='deleted' 的 username/phone 改墓碑值） | ☐ |
| `migration_v22.sql` | **4.30up · A 方案** — `messages` 表加 `aborted` 列 + 部分索引 `idx_messages_conv_active`（仅索引未中断行）<br>chat 路由拉历史时 `.eq("aborted", false)` 过滤被中断的 turn | ✅ 2026-04-30 |
| `migration_v24.sql` | **5.6up** — 后台修改用户所属组织。`users` 加 `force_relogin_at TIMESTAMPTZ`；新增 RPC `change_user_tenant(user_id, new_tenant_code)` 单事务做完：改 users（含 user_type/role/dept_id/team_id 同步）+ 清理跨组织分组成员 + 追溯改 logs.tenant_code + 写一条 audit 事件<br>v23 编号已被"组织码可改"草案占名（已搁置），故跳号到 v24 | ✅ 2026-05-06 |
| `migration_v25.sql` | **5.7up · GPT 接入阶段一** — `tenants` 加 `openai_key_enc / openai_key_set_at / openai_key_set_by`；`logs` 加 `prompt_tokens / completion_tokens / model_used` + `logs_model_used_idx` 索引；新建 `model_quota_weights` 表（种子 4o-mini=1 / 4o=5 / o1 系列默认禁用）；新增加权扣额度 RPC `increment_quota_used_weighted(p_code, p_weight)`（内部守卫 `quota_used + weight <= quota`）<br>5.16up 从 devA 分支补录文件入仓库 | ✅ 2026-05（用户已跑） |
| `migration_v26.sql` | **5.7up · GPT 接入阶段二** — `conversations` 加 `summary_text TEXT` + `summary_until_at TIMESTAMPTZ`，支撑滑动窗口 + 增量摘要降本<br>5.16up 从 devA 分支补录文件入仓库 | ✅ 2026-05（用户已跑） |
| `migration_v27.sql` | **5.8up** — 新增 `audit_logs` 表，记录管理员对智能体/工作流的增删改操作；含 created_at / resource_type / action 三个索引 | ☐ |
| `migration_v28.sql` | **5.8fix** — `audit_logs` 移除 `admin_id` 外键约束（org_admin 的 ID 来自 users 表、非 admins 表，旧 FK 致审计写入 FK 违例后静默失败） | ✅（功能在用，推定已跑） |
| `migration_v29.sql` | **5.9** — 新增 `workflow_sessions` 表（工作流会话实例） | ✅（功能在用，推定已跑） |
| `migration_v30.sql` | **5.9** — `conversations` 加 `session_id` 列（关联工作流会话）+ `idx_conversations_session` 索引 | ✅（功能在用，推定已跑） |
| `migration_v31.sql` | **5.11up** — `workflows` 加 `created_by` + `created_by_role`；数据迁移：历史 NULL 回填 `system_admin` | ✅（功能在用，推定已跑） |
| `migration_v32.sql` | **5.11up** — `audit_logs` 加 `admin_tenant_code` + `resource_tenant_code` + 索引；数据迁移：backfill 历史 tenant_code（支撑组织管理员按本组织过滤审计） | ✅（功能在用，推定已跑） |
| `migration_v33.sql` | **5.12up** — `users` 加生成列 `role_priority` + 索引（后台用户列表按角色优先级排序，而非字母序） | ✅（功能在用，推定已跑） |
| `migration_v34_logs_status_aborted.sql` | **5.15up** — `logs.status` CHECK 加 `'aborted'`，修 chat aborted 日志被 DB 静默拒收的 bug | ✅ 2026-05-15 |
| `migration_v35_model_providers.sql` | **5.15up PR-A** — 新增 `model_providers` 表（统一模型供应商：编号/名称/平台/endpoint/加密 key/默认模型参数/启停 + enabled、platform 索引） | ✅ 2026-05-15 |
| `migration_v36_agent_drafts.sql` | **5.15up PR-B** — 新增 `agent_drafts` 表；`agents` 加 `provider_id` / `builder_config` / `published_from_draft_id` 三列 | ✅ 2026-05-15 |
| `migration_v37_model_providers_category.sql` | **5.15up API 管理 PR-1** — `model_providers` 加 `category` 列（model/agent）+ CHECK 约束 + `(category,enabled)`、`(category,platform)` 索引；存量按 platform 归类 | ✅ 2026-05-15 |
| `migration_v38_knowledge_base.sql` | **5.19up 知识库方案 A · PR-A1**【🔑 知识库上线必跑】启用 `pgvector`；新增 `knowledge_bases` / `kb_documents` / `kb_chunks`（`embedding vector(1024)` + HNSW 余弦索引）/ `agent_knowledge_bases` 4 表；`model_providers.category` CHECK 加 `'embedding'`（D1-2）；新增检索 RPC `match_kb_chunks(p_kb_ids, p_query, p_top_k, p_threshold)` | ☐ |
| `migration_v39_kb_chunks_active_filter.sql` | **5.19up 方案 A 小B验收 finding 1**【🔑 知识库上线必跑】`match_kb_chunks` RPC 加 `knowledge_bases.status='active'` 过滤（停用知识库不参与检索）；签名 / 返回字段保持不变。**未跑 v39 = 后台"停用"按钮无效。** | ☐ |
| `migration_v40_kb_doc_total_chunks.sql` | **5.28up A 阶段**【知识库进度条 · 必跑】`kb_documents` 加 `total_chunks INT DEFAULT 0` 列；ingest 改后台异步后，前端轮询要拿"已完成 N / 总数"做进度条。⚠ 5.28up 后端 `select` 已经直接拉 `total_chunks` 字段，**不跑此条 → 知识库详情 / 文档列表 API 直接 500（缺列）**，必须先跑此 SQL 再发 5.28up 代码。 | ☐ |
| `migration_v41_kb_chunks_unique.sql` | **5.28up Fix 3**【知识库数据完整性】`kb_chunks` 加 `(document_id, chunk_index)` UNIQUE 约束 + 一次性去重（保留 id 最大行）。reindex 服务端虽已加并发保护，UNIQUE 兜底防其它路径误插重复段（检索会拿到重复、挤占 prompt）。不跑无功能性后果，但失去 DB 层保护。 | ☐ |
| `migration_v42_match_kb_chunks_done_filter.sql` | **5.28up 小B 复审 Fix 1**【🔑 知识库数据正确性】`match_kb_chunks` RPC 加 `kb_documents.status='done'` 过滤；签名 / 返回字段保持冻结契约不变。⚠ 5.28up A 分批 insert 后中途失败的"半截文档"也会有 chunks 落库，**不跑此条 → 失败 / 索引中文档的部分片段可能被 chat 引用**。代码层 ingest.ts 内 fail() 主动清理已 insert chunks（双保险），但 RPC 层这条仍是必跑（防其它路径产生半截数据）。 | ☐ |
| `migration_v43_scoped_ownership.sql` | **5.30up · 组织级 ownership 基建**【🔑 RBAC 必跑】`model_providers` + `knowledge_bases` 各加 `tenant_code TEXT NULL` + 单列 BTREE 索引。语义：NULL = 平台公共（super/system 建），非 NULL = 某 org 建。存量行回填默认 NULL（与现有行为兼容）。⚠ 5.30up 后端 list / canReadRow / canWriteRow / resolveCreateOwnership 都依赖 `tenant_code` 字段，**不跑此条 → API 管理 + 知识库管理 list/CRUD 5xx（缺列）**。必须先跑 SQL 再发 5.30up 代码。 | ☐ |
| `migration_v44_anthropic_platform.sql` | **5.30.1 · Anthropic 接入**【🔑 接 Claude 必跑】`model_providers.platform` CHECK 扩 `'anthropic'` + `model_quota_weights` 种子加 `claude-haiku-4-5-20251001`=3 / `claude-sonnet-4-6`=8 / `claude-opus-4-8`=15。⚠ 不跑此条 → 新建 anthropic provider 时被 CHECK 约束拒（platform 不允许）；用 claude 对话时 `model_quota_weights` 查不到走 weight=1 软放过（成本被低估）。 | ☐ |
| `migration_v50_custom_roles.sql` | **6.4up · 权限管理 · 自定义角色基建**【🔑 权限管理上线必跑】新建 3 张表 `custom_roles` / `custom_role_permissions` / `user_custom_roles`；`workflows` 加 `created_by_kind`（CHECK admin/custom_admin）+ `created_by_role_code`；历史行回填 `kind='admin', role_code=created_by_role`。旧 `created_by_role` 列与 v31 CHECK 不动。permission_key 不在 DB 加 CHECK（由 `lib/permission-keys.ts` + API 校验）。⚠ 不跑此条 → 自定义角色 CRUD / 用户绑角色 / custom admin 创建工作流全 500。 | ☐ |
| `migration_v51_workflows_drop_created_by_fk.sql` | **6.4up R2 Fix 1 · workflows.created_by drop FK**【🔑 权限管理上线必跑】DO BLOCK 按列反查所有 FK 并循环 drop（不赌约束名）。与 6.3up 的 v49 语义等价；起因是 custom admin actorId 是 `users.id`，写入 `workflows.created_by` 会撞 v31 加的 FK to `admins(id)`。⚠ 不跑此条（且未跑过 6.3up v49）→ custom admin 新建工作流必失败 23503。 | ☐ |
| `migration_v52_permission_v2.sql` | **6.4up v2 Phase A · 权限管理 v2 基建**【🔑 v2 enforce 上线必跑 · 跑完行为不变】新建 2 张表 `builtin_role_permissions`（system_admin / org_admin 默认包，CHECK 不含 super_admin）+ `admin_permission_overrides`（个人 grant/revoke，PK 含 admin_source 防 admin_table vs user_admin UUID 撞）；seed 173 条与现状代码完全等价（system_admin 109 / org_admin 64，零默默放权）；新建 RPC `change_user_role_clear_custom(p_user_id, p_new_role, p_actor_id)`：role 从 user 变 builtin admin 时一次事务做完 UPDATE role + DELETE user_custom_roles + INSERT audit_logs。**行为切换由 env `PERMISSION_V2_ENFORCE_RESOURCES` CSV 控制**：空 = 等价 6.4up 行为；`"notice,category"` = 仅这两类资源走 v2 enforce；回滚清空 CSV。⚠ 不跑此条 → 应用层 `PERMISSION_V2_ENFORCE_RESOURCES` 设非空时所有路由 500（缺表）；env 留空时跑不跑都无所谓。<br>**R1 强依赖**（2026-06-06 收口）：set-role 升 builtin admin 路径已移除 42883 RPC 缺失 fallback —— v52 跑过 = 必要前置；未跑 v52 + 调 set-role 升 admin → 500（不再静默 fallback 留 user_custom_roles 不清）。 | ☐ |

> v20 / v23 跳号无对应文件（v23 编号被已搁置的"组织码可改"草案占用）。
> v45 跳号无对应文件；v46~v49 占号在 `feature/6.3up` 分支（工作流分层级配置：scope_order 表 / RPC / perms→order 触发器 / drop workflows.created_by FK）。
> 待 6.3up 合入 master2 后本表会补齐 v46~v49 行；6.4up 的 v50 与 v46~v49 互不依赖、可独立跑。
> v51 与 6.3up 的 v49 语义等价（同样 drop workflows.created_by FK）；两条均按"IF EXISTS"幂等，重复跑安全。
> v28~v33 已于 5.16up 回归核查时补登 —— "跑过"列标「功能在用，推定已跑」的，
> 是因对应表 / 列已被线上代码依赖且回归测试通过、可证已执行；如需精确日期请按需复核。

## 🔑 知识库（5.19up）上线必跑迁移

知识库功能依赖以下 **两条** 迁移，**少跑任何一条都会让方案A 行为不完整 / 安全语义打折扣**：

| 顺序 | 文件 | 后果（如果不跑） |
| --- | --- | --- |
| 1 | `migration_v38_knowledge_base.sql` | 4 张 KB 表 + RPC 都不存在 —— 知识库后台、文档上传、对话检索全部 500 |
| 2 | `migration_v39_kb_chunks_active_filter.sql` | RPC 没有 `status='active'` 过滤 —— 后台「停用知识库」按钮**形同虚设**，已绑定智能体仍能命中停用库的片段 |

**验证 SQL**（任何时候都可跑，幂等）：

```sql
-- 1. 4 张表都建了
SELECT count(*) FROM knowledge_bases;
SELECT count(*) FROM kb_documents;
SELECT count(*) FROM kb_chunks;
SELECT count(*) FROM agent_knowledge_bases;

-- 2. RPC 存在
SELECT proname FROM pg_proc WHERE proname = 'match_kb_chunks';

-- 3. 关键：RPC 函数体里必须包含 `kb.status = 'active'`
-- 这是 v39 是否跑过的判定标准
SELECT pg_get_functiondef(oid) AS def
FROM pg_proc
WHERE proname = 'match_kb_chunks';
-- 验收：返回的 def 字段中，应能搜到 "kb.status = 'active'"
--        找不到 = v39 没跑过 / 跑失败，需要重跑

-- 4. model_providers.category 允许 'embedding'
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'model_providers_category_check';
-- 验收：返回应包含 'embedding'，否则 v38 没跑（或被旧 v37 约束拦截）
```

跑完都打 ✅。

## 体验版（trial 模块）

| 文件 | 主要内容 | 跑过 |
| --- | --- | --- |
| `migration_trial.sql` | 4.28up · users.user_type 加 'trial' 值 + 预置体验账号 `18700000008 / 12345678` | ☐ |
| `migration_trial_conversations.sql` | 4.28up · trial_conversations 表（体验版独立会话表） | ☐ |
| `migration_trial_conversations_v2.sql` | 4.28up · trial_conversations 多会话改造（每用户多 chat） | ☐ |
| `migration_trial_messages.sql` | Phase 1 / 4.30up · trial_messages 表（多平台多轮上下文 + 历史回放） | ☐ |

---

## 约定（重要）

1. **每次 DB 改动 = 新建 1 个 migration 文件**，文件名 `migration_v{N}.sql`（N 递增）或主题前缀（如 `migration_trial_*`）
2. **绝不修改已发布的旧 migration**——线上库的状态 = 按顺序跑过的文件总和，回头改文件 = 历史断裂
3. 文件头部固定写 4 行注释：版本号、来自哪个 up 包、改了什么表、是否需要数据迁移
4. SQL 语句加 `IF NOT EXISTS` / `IF EXISTS`，保证幂等可重跑
5. 每次新增本表：在 [MIGRATIONS.md](MIGRATIONS.md) 末尾追一行索引
6. 推 master / 部署生产时，**先跑 SQL 再发代码**——避免代码引用未建的列/表 500
7. 这份文档的 ✅ / ☐ 你自己维护——跑过的打 ✅，没跑的留空

下次让 AI 改 DB 时，提醒它："新文件 + 更新 MIGRATIONS.md"。
