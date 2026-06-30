-- v56 · 6.30up · 知识库可见范围接入 resource_permissions
--
-- 目的：
--   - 允许 resource_permissions.resource_type = 'knowledge_base'
--   - 后台知识库编辑页可把 KB 设置为全部 / 组织 / 部门 / 小组可见
--   - 运行时检索按当前用户范围过滤显式配置过的 KB

ALTER TABLE resource_permissions
  DROP CONSTRAINT IF EXISTS resource_permissions_resource_type_check;

ALTER TABLE resource_permissions
  ADD CONSTRAINT resource_permissions_resource_type_check
  CHECK (resource_type IN ('agent', 'workflow', 'knowledge_base'));

CREATE INDEX IF NOT EXISTS resource_permissions_kb_visibility_idx
  ON resource_permissions (resource_type, resource_id, scope_type, scope_id)
  WHERE resource_type = 'knowledge_base';

NOTIFY pgrst, 'reload schema';
