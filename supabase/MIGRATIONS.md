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
| `migration_v38_knowledge_base.sql` | **5.19up 知识库方案 A · PR-A1** — 启用 `pgvector`；新增 `knowledge_bases` / `kb_documents` / `kb_chunks`（`embedding vector(1024)` + HNSW 余弦索引）/ `agent_knowledge_bases` 4 表；`model_providers.category` CHECK 加 `'embedding'`（D1-2）；新增检索 RPC `match_kb_chunks(p_kb_ids, p_query, p_top_k, p_threshold)` | ☐ |

> v20 / v23 跳号无对应文件（v23 编号被已搁置的"组织码可改"草案占用）。
> v28~v33 已于 5.16up 回归核查时补登 —— "跑过"列标「功能在用，推定已跑」的，
> 是因对应表 / 列已被线上代码依赖且回归测试通过、可证已执行；如需精确日期请按需复核。

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
