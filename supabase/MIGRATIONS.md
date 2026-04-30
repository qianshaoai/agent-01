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

> v20 跳号未使用。

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
