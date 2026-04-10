-- ============================================================
-- 迁移 v13：补齐 teams 表的 tenant_code 列
-- 原因：migration_v7.sql 创建 teams 表时漏了 tenant_code 列，
--       但 API 代码（/api/admin/teams）在 GET/POST 都用到此列
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- 1. 补列
ALTER TABLE teams ADD COLUMN IF NOT EXISTS tenant_code TEXT;

-- 2. 回填已有数据：通过 departments 关联继承 tenant_code
UPDATE teams t
SET    tenant_code = d.tenant_code
FROM   departments d
WHERE  t.dept_id = d.id
  AND  t.tenant_code IS NULL;

-- 3. 建索引方便按组织筛选
CREATE INDEX IF NOT EXISTS teams_tenant_code_idx ON teams(tenant_code);

-- 4. 刷新 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
