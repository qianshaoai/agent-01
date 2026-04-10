-- ============================================================
-- 迁移 v14：admins 表增加 role 字段（修复越权 bug）
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- 1. 给 admins 表加 role 列
--    默认所有现有 admin 为 super_admin，保证向后兼容
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin'
  CHECK (role IN ('super_admin', 'system_admin', 'org_admin'));

-- 2. 组织管理员需要关联到具体组织（super/system 级别为 NULL）
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS tenant_code TEXT;

-- 3. users.status 新增 'cancelled' 值（用户主动注销）
--    deleted = 后台管理员删除；cancelled = 用户自己注销账号
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'disabled', 'deleted', 'cancelled'));

-- 4. 刷新 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
