-- ============================================================
-- 迁移 v16：工作流可见权限接入 resource_permissions 体系
-- 支持：全部 / 仅组织 / 仅个人 / 指定组织 / 指定部门 / 指定小组
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 把现有 workflows.visible_to 里存的逗号分隔组织码迁移到
--      resource_permissions 表（scope_type='org'）
-- ── 1a. 先插入权限规则：每个组织码一行
INSERT INTO resource_permissions (resource_type, resource_id, scope_type, scope_id)
SELECT 'workflow', w.id, 'org', TRIM(code)
FROM workflows w,
     UNNEST(STRING_TO_ARRAY(w.visible_to, ',')) AS code
WHERE w.visible_to IS NOT NULL
  AND w.visible_to NOT IN ('all', 'org_only', 'personal_only', 'custom', '')
  AND TRIM(code) <> ''
ON CONFLICT DO NOTHING;

-- ── 1b. 把这些工作流的 visible_to 统一改成 'custom'
UPDATE workflows
SET visible_to = 'custom'
WHERE visible_to IS NOT NULL
  AND visible_to NOT IN ('all', 'org_only', 'personal_only', 'custom', '');

-- ── 1c. 空字符串统一为 'all'
UPDATE workflows SET visible_to = 'all' WHERE visible_to IS NULL OR visible_to = '';

-- ── 2. 刷新 PostgREST schema cache
NOTIFY pgrst, 'reload schema';
