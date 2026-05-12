-- migration_v33
-- 版本：v33
-- 来自：5.12up
-- 改了什么表：users 加生成列 role_priority + 索引
-- 是否需要数据迁移：否（生成列由 DB 自动填值）
--
-- 目的：让后台用户列表按角色优先级排序（super > system > org > user），
--      而不是字母序（org < super < system < user）。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_priority INT
  GENERATED ALWAYS AS (
    CASE role
      WHEN 'super_admin'  THEN 4
      WHEN 'system_admin' THEN 3
      WHEN 'org_admin'    THEN 2
      ELSE 1  -- user / NULL / 其他
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_users_role_priority
  ON users (role_priority DESC, created_at DESC);
