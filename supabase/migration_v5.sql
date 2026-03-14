-- Migration v5: user nickname, status, last_login_at
-- Run in Supabase SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled', 'deleted'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
