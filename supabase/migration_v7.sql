-- Migration v7: user_type, role, username, real_name + departments/teams
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ── 1. users 表新增字段 ────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS username  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type TEXT NOT NULL DEFAULT 'personal'
  CHECK (user_type IN ('personal', 'organization'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('super_admin', 'system_admin', 'org_admin', 'user'));

-- ── 2. 部门表 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS departments_tenant_code_idx ON departments(tenant_code);

-- ── 3. 小组表 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dept_id     UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS teams_dept_id_idx ON teams(dept_id);

-- ── 4. users 表新增部门/小组字段 ──────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS dept_id UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- ── 5. 索引 ───────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_user_type_idx ON users(user_type);
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

-- ── 6. 刷新 PostgREST schema 缓存 ────────────────────────────────
NOTIFY pgrst, 'reload schema';
