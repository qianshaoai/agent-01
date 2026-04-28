-- 4.28up 体验版模块 · 阶段一 migration
--
-- 用途：
--   1) 扩展 users.user_type CHECK 约束以接纳 'trial'
--   2) 预置体验账号 18700000008 / 12345678
--
-- 执行前请先确认手机号唯一性：
--   SELECT phone, tenant_code, user_type FROM users WHERE phone='18700000008';
--   - 0 行：直接执行本文件
--   - 1 行且 tenant_code='PERSONAL'：本文件的 UPSERT 会更新该条
--   - 其他情况：先在 SQL Editor 处理冲突，再执行本文件
--
-- bcrypt hash 生成（开发者本地一次性执行）：
--   node -e "console.log(require('bcryptjs').hashSync('12345678', 12))"
-- 把输出粘到下面的占位 <BCRYPT_HASH_OF_12345678> 替换。

BEGIN;

-- 1) 扩展 user_type CHECK 约束 ────────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_user_type_check;
ALTER TABLE users
  ADD CONSTRAINT users_user_type_check
  CHECK (user_type IN ('personal', 'organization', 'trial'));

-- 2) 预置体验账号 ────────────────────────────────────────────────────────────
-- users 表唯一约束：UNIQUE (phone, tenant_code) + UNIQUE username
-- 复合唯一冲突时把账号"硬切"为体验账号：
--   - pwd_hash 强制覆盖，确保用 12345678 一定能登录
--   - username/real_name/role 一并对齐，避免登录页要求用用户名登录或角色错位
-- 警告：如果该手机号 + PERSONAL 之前是真实用户，执行后原密码失效、角色变 user。
--       这是体验账号预置的预期行为，请提前确认 18700000008+PERSONAL 不属于正式用户。
INSERT INTO users (
  phone, username, pwd_hash, real_name,
  tenant_code, user_type, status, first_login, role
)
VALUES (
  '18700000008',
  'trial001',
  '$2b$12$jbikl5IruAMxRwwCzqYBWuzSVbjz/jNo5IjO5mzU.pjPo6vAjW84.',
  '体验账号',
  'PERSONAL',
  'trial',
  'active',
  false,        -- 关键：避免首次改密弹窗截断 /trial 跳转
  'user'
)
ON CONFLICT (phone, tenant_code) DO UPDATE SET
  username    = EXCLUDED.username,
  pwd_hash    = EXCLUDED.pwd_hash,
  real_name   = EXCLUDED.real_name,
  user_type   = EXCLUDED.user_type,
  status      = EXCLUDED.status,
  first_login = EXCLUDED.first_login,
  role        = EXCLUDED.role;

COMMIT;

-- 验证：
--   SELECT phone, username, tenant_code, user_type, status, first_login
--     FROM users WHERE phone='18700000008';
--   预期：18700000008 / trial001 / PERSONAL / trial / active / false
