-- v60 · 7.28up
-- 工作流绑定智能体 Picker：数据库内完成权限过滤、搜索与稳定分页。
-- 依赖 v57 public.agent_effective_admin_scopes。
-- SECURITY INVOKER；仅 service_role 可执行，浏览器角色无执行权。

CREATE OR REPLACE FUNCTION public.admin_agent_picker_page(
  p_tenant_code text,
  p_can_read_all boolean,
  p_can_read_org boolean,
  p_q text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
WITH visible_agents AS (
  SELECT
    a.id,
    a.agent_code,
    a.name,
    a.platform,
    a.agent_type,
    a.published_from_draft_id
  FROM public.agents AS a
  CROSS JOIN LATERAL (
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.agent_effective_admin_scopes AS eas
      LEFT JOIN public.departments AS d
        ON eas.scope_type = 'dept'
       AND d.id::text = eas.scope_id
      LEFT JOIN public.teams AS tm
        ON eas.scope_type = 'team'
       AND tm.id::text = eas.scope_id
      WHERE eas.agent_id = a.id
        AND (
          eas.scope_type = 'all'
          OR (
            eas.scope_type = 'org'
            AND eas.scope_id IS DISTINCT FROM p_tenant_code
          )
          OR (
            eas.scope_type = 'dept'
            AND d.tenant_code IS DISTINCT FROM p_tenant_code
          )
          OR (
            eas.scope_type = 'team'
            AND tm.tenant_code IS DISTINCT FROM p_tenant_code
          )
          OR eas.scope_type NOT IN ('org', 'dept', 'team')
        )
    ) AS within_org
  ) AS scope_check
  WHERE p_can_read_all
     OR (
       p_can_read_org
       AND p_tenant_code IS NOT NULL
       AND scope_check.within_org
     )
),
filtered AS (
  SELECT va.*
  FROM visible_agents AS va
  WHERE NULLIF(BTRIM(p_q), '') IS NULL
     OR va.name ILIKE '%' || BTRIM(p_q) || '%'
     OR va.agent_code ILIKE '%' || BTRIM(p_q) || '%'
     OR va.platform ILIKE '%' || BTRIM(p_q) || '%'
),
paged AS (
  SELECT f.*
  FROM filtered AS f
  ORDER BY f.name ASC, f.id ASC
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 50)
  LIMIT LEAST(GREATEST(p_page_size, 1), 50)
)
SELECT jsonb_build_object(
  'contractVersion', 2,
  'data',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'agent_code', p.agent_code,
            'name', p.name,
            'platform', p.platform,
            'agent_type', p.agent_type,
            'published_from_draft_id', p.published_from_draft_id
          )
          ORDER BY p.name ASC, p.id ASC
        )
        FROM paged AS p
      ),
      '[]'::jsonb
    ),
  'pagination',
    jsonb_build_object(
      'page', GREATEST(p_page, 1),
      'pageSize', LEAST(GREATEST(p_page_size, 1), 50),
      'total', (SELECT COUNT(*)::bigint FROM filtered)
    )
);
$function$;

REVOKE ALL ON FUNCTION public.admin_agent_picker_page(
  text, boolean, boolean, text, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_agent_picker_page(
  text, boolean, boolean, text, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
