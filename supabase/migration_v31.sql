-- migration_v31
-- 版本：v31
-- 来自：5.11up
-- 改了什么表：workflows 新增 created_by + created_by_role
-- 是否需要数据迁移：是（历史 NULL 回填为 system_admin —— 决策 1=B）

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS created_by         UUID REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_role    TEXT;

CREATE INDEX IF NOT EXISTS idx_workflows_created_by_role ON workflows (created_by_role);

-- CHECK 约束：role 字段只能是这三个值之一
ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS chk_workflows_created_by_role;
ALTER TABLE workflows
  ADD CONSTRAINT chk_workflows_created_by_role
  CHECK (created_by_role IS NULL OR created_by_role IN ('super_admin', 'system_admin', 'org_admin'));

-- 历史数据回填：所有现存 workflow（created_by_role IS NULL）标记为 system_admin 创建
-- 这样系统管理员和超级管理员都能改，组织管理员动不了历史工作流
UPDATE workflows SET created_by_role = 'system_admin' WHERE created_by_role IS NULL;
