-- migration_v19: 补充高频查询字段索引
CREATE INDEX IF NOT EXISTS users_tenant_code_idx       ON users (tenant_code);
CREATE INDEX IF NOT EXISTS users_role_idx              ON users (role);
CREATE INDEX IF NOT EXISTS agents_enabled_idx          ON agents (enabled);
CREATE INDEX IF NOT EXISTS conversations_user_id_idx   ON conversations (user_id);
CREATE INDEX IF NOT EXISTS agent_categories_agent_idx  ON agent_categories (agent_id);
CREATE INDEX IF NOT EXISTS wf_categories_wf_idx        ON workflow_categories (workflow_id);
CREATE INDEX IF NOT EXISTS res_perms_resource_idx      ON resource_permissions (resource_type, resource_id);
