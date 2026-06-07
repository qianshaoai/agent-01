-- v53
-- 6.6up · 权限后端全量补齐
-- builtin_role_permissions 补 user_group 默认包 seed；无表结构变更
-- 幂等，可在已跑 v52 的环境重复执行

DO $$
BEGIN
  IF to_regclass('public.builtin_role_permissions') IS NULL THEN
    RAISE EXCEPTION 'builtin_role_permissions 不存在，请先执行 migration_v52_permission_v2.sql';
  END IF;
END $$;

INSERT INTO builtin_role_permissions (role, permission_key) VALUES
  ('system_admin', 'user_group.read.org'),
  ('system_admin', 'user_group.read.all'),
  ('system_admin', 'user_group.create.org'),
  ('system_admin', 'user_group.create.all'),
  ('system_admin', 'user_group.update.org'),
  ('system_admin', 'user_group.update.all'),
  ('system_admin', 'user_group.delete.org'),
  ('system_admin', 'user_group.delete.all'),
  ('org_admin', 'user_group.read.org'),
  ('org_admin', 'user_group.create.org'),
  ('org_admin', 'user_group.update.org'),
  ('org_admin', 'user_group.delete.org')
ON CONFLICT (role, permission_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
