-- ============================================================
-- 迁移 v49：workflows.created_by 移除外键约束
-- 6.3up · R1.10 · 2026-06-03
--
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
--
-- 起因：用户实测新建工作流报"关联数据不存在"（PG 23503 FK violation）。
--
-- 根因：v31 把 `workflows.created_by` 定义成 `UUID REFERENCES admins(id)`，
-- 但管理员 JWT 的 adminId 来源有两种：
--   - 内置管理员 → admin.adminId = admins.id  → FK 通过
--   - 普通用户被提升为管理员 → admin.adminId = users.id → admins 表里没这 id → 23503
-- 与 v28 修 `audit_logs.admin_id` 同款 bug。
--
-- 修法：drop FK 约束。created_by 字段保留，业务层（lib/admin-permissions.ts）
-- 仅按 created_by_role 字段判定上下级权限，不依赖 FK。
-- ============================================================

-- ── 1. drop FK 约束（约束名可能因建表方式不同，用 DO BLOCK 兜底）────
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'workflows'
    AND att.attname = 'created_by'
    AND con.contype = 'f'  -- foreign key
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE workflows DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK constraint: %', v_constraint_name;
  ELSE
    RAISE NOTICE 'No FK constraint on workflows.created_by found (already dropped or never existed)';
  END IF;
END $$;

-- ── 2. 刷新 PostgREST schema 缓存 ──────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 验证 SQL（可重复执行）
-- ============================================================
-- 应返回 0 行（FK 已删）
-- SELECT con.conname
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
-- WHERE rel.relname = 'workflows'
--   AND att.attname = 'created_by'
--   AND con.contype = 'f';
