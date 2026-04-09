-- Migration v8: unified resource_permissions table (replaces tenant_agents)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS resource_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('agent', 'workflow')),
  resource_id   UUID NOT NULL,
  -- scope_type: all=全部用户, org=按组织, dept=按部门, team=按小组, user=指定用户, user_type=按用户类型
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('all', 'org', 'dept', 'team', 'user', 'user_type')),
  -- scope_id: NULL for 'all'; tenant_code for 'org'; UUID for dept/team/user; 'personal'/'organization' for user_type
  scope_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index (COALESCE handles NULL scope_id for 'all' type)
CREATE UNIQUE INDEX IF NOT EXISTS resource_permissions_unique_idx
  ON resource_permissions (resource_type, resource_id, scope_type, COALESCE(scope_id, ''));

CREATE INDEX IF NOT EXISTS resource_permissions_resource_idx
  ON resource_permissions (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS resource_permissions_scope_idx
  ON resource_permissions (scope_type, scope_id);

ALTER TABLE resource_permissions DISABLE ROW LEVEL SECURITY;

-- Migrate existing tenant_agents data
INSERT INTO resource_permissions (resource_type, resource_id, scope_type, scope_id)
SELECT 'agent', agent_id, 'org', tenant_code FROM tenant_agents
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
