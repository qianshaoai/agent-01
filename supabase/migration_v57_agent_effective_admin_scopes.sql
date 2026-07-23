-- v57 · 7.23up
-- 新增 agent_effective_admin_scopes 安全视图，统一显式权限与发布草稿创建者回退。
-- 不修改业务数据；Dashboard Summary V2 / Agent Center V2 上线前必须执行。
-- 需要执行权限迁移：仅 service_role 可查询。

CREATE OR REPLACE VIEW public.agent_effective_admin_scopes
WITH (security_invoker = true)
AS
SELECT
  a.id AS agent_id,
  rp.scope_type,
  CASE WHEN rp.scope_type = 'all' THEN NULL ELSE rp.scope_id END AS scope_id,
  'explicit'::text AS scope_source
FROM public.agents AS a
JOIN public.resource_permissions AS rp
  ON rp.resource_type = 'agent'
 AND rp.resource_id = a.id
WHERE rp.scope_type IN ('all', 'org', 'dept', 'team')

UNION ALL

SELECT
  a.id AS agent_id,
  CASE
    WHEN owner_scope.tenant_code IS NULL THEN 'all'
    ELSE 'org'
  END AS scope_type,
  owner_scope.tenant_code AS scope_id,
  'draft_owner_fallback'::text AS scope_source
FROM public.agents AS a
JOIN public.agent_drafts AS d
  ON d.id = a.published_from_draft_id
LEFT JOIN public.admins AS ad
  ON ad.id = d.created_by
LEFT JOIN public.users AS u
  ON u.id = d.created_by
CROSS JOIN LATERAL (
  SELECT COALESCE(ad.tenant_code, u.tenant_code) AS tenant_code
) AS owner_scope
WHERE NOT EXISTS (
  SELECT 1
  FROM public.resource_permissions AS rp_any
  WHERE rp_any.resource_type = 'agent'
    AND rp_any.resource_id = a.id
);

REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM anon;
REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM authenticated;
GRANT SELECT ON TABLE public.agent_effective_admin_scopes TO service_role;

NOTIFY pgrst, 'reload schema';
