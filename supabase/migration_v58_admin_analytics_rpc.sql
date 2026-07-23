-- v58 · 7.23up
-- 新增管理端 Analytics / Dashboard 聚合 RPC，避免日志明细返回 Node.js 后聚合。
-- 不迁移业务数据；函数均使用 SECURITY INVOKER。
-- 撤销浏览器角色执行权，仅 service_role 可调用。

CREATE OR REPLACE FUNCTION public.admin_usage_summary(
  p_tenant_code text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
WITH filtered_logs AS (
  SELECT
    l.agent_code,
    l.agent_name,
    l.status,
    l.created_at
  FROM public.logs AS l
  WHERE l.action = 'chat'
    AND (p_tenant_code IS NULL OR l.tenant_code = p_tenant_code)
    AND (p_since IS NULL OR l.created_at >= p_since)
),
totals AS (
  SELECT
    COUNT(*)::bigint AS total_calls,
    COUNT(*) FILTER (WHERE status = 'success')::bigint AS success_calls
  FROM filtered_logs
),
top_agent_groups AS (
  SELECT
    l.agent_code,
    COUNT(*)::bigint AS calls,
    (ARRAY_AGG(l.agent_name ORDER BY l.created_at DESC)
      FILTER (WHERE l.agent_name IS NOT NULL))[1] AS latest_log_name
  FROM filtered_logs AS l
  WHERE l.status = 'success'
    AND l.agent_code IS NOT NULL
  GROUP BY l.agent_code
  ORDER BY COUNT(*) DESC, l.agent_code
  LIMIT 5
),
top_agents AS (
  SELECT
    g.agent_code AS id,
    COALESCE(a.name, g.latest_log_name, g.agent_code) AS name,
    g.calls
  FROM top_agent_groups AS g
  LEFT JOIN public.agents AS a
    ON a.agent_code = g.agent_code
  ORDER BY g.calls DESC, g.agent_code
),
tenant_usage AS (
  SELECT
    t.code,
    t.name,
    t.quota_used AS used,
    t.quota
  FROM public.tenants AS t
  WHERE p_tenant_code IS NULL OR t.code = p_tenant_code
  ORDER BY t.created_at DESC, t.code
)
SELECT jsonb_build_object(
  'totalCalls', totals.total_calls,
  'successCalls', totals.success_calls,
  'successRate',
    CASE
      WHEN totals.total_calls = 0 THEN 100
      ELSE ROUND((totals.success_calls::numeric / totals.total_calls::numeric) * 100, 1)
    END,
  'topAgents',
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(ta) ORDER BY ta.calls DESC, ta.id) FROM top_agents AS ta),
      '[]'::jsonb
    ),
  'tenantUsage',
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(tu) ORDER BY tu.code) FROM tenant_usage AS tu),
      '[]'::jsonb
    )
)
FROM totals;
$function$;

CREATE OR REPLACE FUNCTION public.admin_user_usage_page(
  p_tenant_code text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_dept_id uuid DEFAULT NULL,
  p_team_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
WITH log_groups AS (
  SELECT
    l.tenant_code,
    l.user_phone,
    COUNT(*)::bigint AS calls,
    MAX(l.created_at) AS last_used
  FROM public.logs AS l
  WHERE l.action = 'chat'
    AND (p_tenant_code IS NULL OR l.tenant_code = p_tenant_code)
    AND (p_since IS NULL OR l.created_at >= p_since)
  GROUP BY l.tenant_code, l.user_phone
),
with_user AS (
  SELECT
    lg.tenant_code,
    lg.user_phone,
    lg.calls,
    lg.last_used,
    current_user_row.id AS user_id,
    current_user_row.real_name,
    current_user_row.username,
    current_user_row.dept_id,
    current_user_row.team_id,
    d.name AS dept_name,
    tm.name AS team_name
  FROM log_groups AS lg
  LEFT JOIN LATERAL (
    SELECT
      u.id,
      u.real_name,
      u.username,
      u.dept_id,
      u.team_id
    FROM public.users AS u
    WHERE u.phone IS NOT DISTINCT FROM lg.user_phone
      AND u.tenant_code IS NOT DISTINCT FROM lg.tenant_code
      AND u.status <> 'deleted'
    ORDER BY
      CASE u.status WHEN 'active' THEN 0 WHEN 'disabled' THEN 1 ELSE 2 END,
      u.created_at DESC,
      u.id
    LIMIT 1
  ) AS current_user_row ON true
  LEFT JOIN public.departments AS d
    ON d.id = current_user_row.dept_id
  LEFT JOIN public.teams AS tm
    ON tm.id = current_user_row.team_id
),
filtered AS (
  SELECT *
  FROM with_user
  WHERE (p_dept_id IS NULL OR dept_id = p_dept_id)
    AND (p_team_id IS NULL OR team_id = p_team_id)
    AND (
      NULLIF(BTRIM(p_search), '') IS NULL
      OR COALESCE(user_phone, '') ILIKE '%' || BTRIM(p_search) || '%'
      OR COALESCE(real_name, '') ILIKE '%' || BTRIM(p_search) || '%'
      OR COALESCE(username, '') ILIKE '%' || BTRIM(p_search) || '%'
    )
),
paged AS (
  SELECT *
  FROM filtered
  ORDER BY calls DESC, last_used DESC, tenant_code NULLS FIRST, user_phone NULLS FIRST
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 100)
  LIMIT LEAST(GREATEST(p_page_size, 1), 100)
),
enriched AS (
  SELECT
    p.user_id AS "userId",
    COALESCE(p.user_phone, 'unknown') AS phone,
    p.tenant_code AS "tenantCode",
    p.real_name AS "realName",
    p.username,
    p.dept_id AS "deptId",
    p.team_id AS "teamId",
    p.dept_name AS "deptName",
    p.team_name AS "teamName",
    p.calls,
    p.last_used AS "lastUsed",
    CASE
      WHEN top_agent.code IS NULL THEN NULL
      ELSE jsonb_build_object(
        'code', top_agent.code,
        'name', top_agent.name,
        'calls', top_agent.calls
      )
    END AS "topAgent"
  FROM paged AS p
  LEFT JOIN LATERAL (
    SELECT
      l.agent_code AS code,
      COALESCE(a.name, MAX(l.agent_name), l.agent_code) AS name,
      COUNT(*)::bigint AS calls
    FROM public.logs AS l
    LEFT JOIN public.agents AS a
      ON a.agent_code = l.agent_code
    WHERE l.action = 'chat'
      AND l.tenant_code IS NOT DISTINCT FROM p.tenant_code
      AND l.user_phone IS NOT DISTINCT FROM p.user_phone
      AND (p_since IS NULL OR l.created_at >= p_since)
      AND l.agent_code IS NOT NULL
    GROUP BY l.agent_code, a.name
    ORDER BY COUNT(*) DESC, l.agent_code
    LIMIT 1
  ) AS top_agent ON true
)
SELECT jsonb_build_object(
  'data',
    COALESCE(
      (
        SELECT jsonb_agg(
          to_jsonb(e)
          ORDER BY e.calls DESC, e."lastUsed" DESC, e."tenantCode" NULLS FIRST, e.phone
        )
        FROM enriched AS e
      ),
      '[]'::jsonb
    ),
  'pagination',
    jsonb_build_object(
      'page', GREATEST(p_page, 1),
      'pageSize', LEAST(GREATEST(p_page_size, 1), 100),
      'total', (SELECT COUNT(*)::bigint FROM filtered)
    )
);
$function$;

CREATE OR REPLACE FUNCTION public.admin_visible_agent_count(
  p_allow_all boolean,
  p_tenant_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
SELECT COUNT(*)::bigint
FROM public.agents AS a
WHERE p_allow_all
   OR (
     p_tenant_code IS NOT NULL
     AND NOT EXISTS (
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
     )
   );
$function$;

REVOKE ALL ON FUNCTION public.admin_usage_summary(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_summary(text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_user_usage_page(
  text, timestamptz, uuid, uuid, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_usage_page(
  text, timestamptz, uuid, uuid, text, integer, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_visible_agent_count(boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_visible_agent_count(boolean, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
