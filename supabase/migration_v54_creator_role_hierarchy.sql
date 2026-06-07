-- v54 · 6.6up · agent/knowledge_base 创建者层级快照
-- 表：agents / knowledge_bases
-- 目的：为 agent、knowledge_base 写操作补 created_by_role 层级闸提供数据
-- 数据迁移：agents 存量保守回填 system_admin；knowledge_bases 优先反查创建者角色，否则 system_admin

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS created_by_role TEXT;

ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS created_by_role TEXT;

DO $$
BEGIN
  ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_created_by_role_check;
  ALTER TABLE agents
    ADD CONSTRAINT agents_created_by_role_check
    CHECK (
      created_by_role IS NULL
      OR created_by_role IN ('super_admin', 'system_admin', 'org_admin')
    );

  ALTER TABLE knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_created_by_role_check;
  ALTER TABLE knowledge_bases
    ADD CONSTRAINT knowledge_bases_created_by_role_check
    CHECK (
      created_by_role IS NULL
      OR created_by_role IN ('super_admin', 'system_admin', 'org_admin')
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_created_by_role
  ON agents(created_by_role);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_created_by_role
  ON knowledge_bases(created_by_role);

UPDATE agents
SET created_by_role = 'system_admin'
WHERE created_by_role IS NULL;

UPDATE knowledge_bases kb
SET created_by_role = COALESCE(
  (
    SELECT a.role
    FROM admins a
    WHERE a.id = kb.created_by
      AND a.role IN ('super_admin', 'system_admin', 'org_admin')
    LIMIT 1
  ),
  (
    SELECT u.role
    FROM users u
    WHERE u.id = kb.created_by
      AND u.role IN ('super_admin', 'system_admin', 'org_admin')
    LIMIT 1
  ),
  'system_admin'
)
WHERE kb.created_by_role IS NULL;
