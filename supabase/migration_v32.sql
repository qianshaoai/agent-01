-- migration_v32
-- 版本：v32
-- 来自：5.11up
-- 改了什么表：audit_logs 新增 admin_tenant_code + resource_tenant_code
-- 是否需要数据迁移：是（backfill 历史记录的 tenant_code 字段）
-- 目的：支持组织管理员按本组织过滤审计记录

-- ─ 1. 加列 + 索引 ───────────────────────────────────────
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS admin_tenant_code    TEXT,
  ADD COLUMN IF NOT EXISTS resource_tenant_code TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_tenant
  ON audit_logs (admin_tenant_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_tenant
  ON audit_logs (resource_tenant_code, created_at DESC);

-- ─ 2. backfill admin_tenant_code（通过 admin_id 反查 admins.tenant_code）─
UPDATE audit_logs SET admin_tenant_code = a.tenant_code
FROM admins a
WHERE audit_logs.admin_id = a.id
  AND audit_logs.admin_tenant_code IS NULL
  AND a.tenant_code IS NOT NULL;

-- ─ 3. backfill resource_tenant_code（按 resource_type 分类） ──

-- 3.1 notice：notices.tenant_code
UPDATE audit_logs SET resource_tenant_code = n.tenant_code
FROM notices n
WHERE audit_logs.resource_type = 'notice'
  AND audit_logs.resource_id = n.id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.2 user：users.tenant_code
UPDATE audit_logs SET resource_tenant_code = u.tenant_code
FROM users u
WHERE audit_logs.resource_type = 'user'
  AND audit_logs.resource_id = u.id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.3 department：departments.tenant_code
UPDATE audit_logs SET resource_tenant_code = d.tenant_code
FROM departments d
WHERE audit_logs.resource_type = 'department'
  AND audit_logs.resource_id = d.id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.4 team：经 dept 到 tenant_code
UPDATE audit_logs SET resource_tenant_code = d.tenant_code
FROM teams t
JOIN departments d ON t.dept_id = d.id
WHERE audit_logs.resource_type = 'team'
  AND audit_logs.resource_id = t.id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.5 tenant：resource_id 本身就是 tenant code
UPDATE audit_logs SET resource_tenant_code = audit_logs.resource_id
WHERE audit_logs.resource_type = 'tenant'
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.6 workflow：resource_permissions 中第一条 scope=org 的 scope_id
-- DISTINCT ON 只需要按 resource_id 排序，任意挑一条 scope=org 的即可
UPDATE audit_logs SET resource_tenant_code = rp.scope_id
FROM (
  SELECT DISTINCT ON (resource_id) resource_id, scope_id
  FROM resource_permissions
  WHERE resource_type = 'workflow' AND scope_type = 'org'
  ORDER BY resource_id
) rp
WHERE audit_logs.resource_type = 'workflow'
  AND audit_logs.resource_id = rp.resource_id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.7 workflow_step：经 workflow_id 反查
UPDATE audit_logs SET resource_tenant_code = rp.scope_id
FROM workflow_steps ws
JOIN (
  SELECT DISTINCT ON (resource_id) resource_id, scope_id
  FROM resource_permissions
  WHERE resource_type = 'workflow' AND scope_type = 'org'
  ORDER BY resource_id
) rp ON ws.workflow_id = rp.resource_id
WHERE audit_logs.resource_type = 'workflow_step'
  AND audit_logs.resource_id = ws.id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 3.8 agent：tenant_agents 取第一条绑定
-- tenant_agents 是个简单 M2M 表，没 created_at 列；按 agent_id 排序即可
UPDATE audit_logs SET resource_tenant_code = ta.tenant_code
FROM (
  SELECT DISTINCT ON (agent_id) agent_id, tenant_code
  FROM tenant_agents
  ORDER BY agent_id
) ta
WHERE audit_logs.resource_type = 'agent'
  AND audit_logs.resource_id = ta.agent_id::text
  AND audit_logs.resource_tenant_code IS NULL;

-- 全局资源（category / wf_category / user_group / settings / resource_permission）
-- 保持 NULL，组织管理员看不到，符合"只看本组织相关"的语义
