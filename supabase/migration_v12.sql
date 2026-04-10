-- ============================================================
-- 迁移 v12：用户分组 + 资源权限支持分组
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 用户分组表 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- tenant_code: NULL = 全平台分组，非 NULL = 仅限该组织内可见
  tenant_code TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_groups DISABLE ROW LEVEL SECURITY;

-- ── 2. 分组成员关联表 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_group_members (
  group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE user_group_members DISABLE ROW LEVEL SECURITY;

-- ── 3. resource_permissions 新增 'group' scope 类型 ────────────
ALTER TABLE resource_permissions
  DROP CONSTRAINT IF EXISTS resource_permissions_scope_type_check;

ALTER TABLE resource_permissions
  ADD CONSTRAINT resource_permissions_scope_type_check
  CHECK (scope_type IN ('all', 'org', 'dept', 'team', 'user', 'user_type', 'group'));
