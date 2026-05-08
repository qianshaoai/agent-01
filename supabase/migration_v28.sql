-- migration_v28
-- 版本：v28
-- 来自：5.8fix
-- 改了什么表：audit_logs — 移除 admin_id 外键约束
-- 原因：org_admin 用户的 ID 来自 users 表，而非 admins 表，
--       旧的 FK 约束导致审计日志写入时 FK 违例，静默失败

-- 如果 v27 已经执行，需要找到并删除 admin_id 的 FK 约束
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
  WHERE pg_class.relname = 'audit_logs'
    AND pg_constraint.contype = 'f'
    AND pg_constraint.conkey @> ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = pg_class.oid AND attname = 'admin_id')
    ]::smallint[];

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK constraint % from audit_logs.admin_id', v_constraint_name;
  ELSE
    RAISE NOTICE 'No FK constraint found on audit_logs.admin_id, nothing to do.';
  END IF;
END$$;
