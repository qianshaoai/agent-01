-- v61 · 7.28up
-- 工作流管理页：权限可见性、筛选、统计、focus 定位和分页统一下推到 PostgreSQL。
-- 权限参数只能由服务端在完成登录校验后构建；浏览器不得直传。

CREATE OR REPLACE FUNCTION public.admin_workflow_page(
  p_can_read_all boolean,
  p_scope_org text,
  p_scope_dept uuid,
  p_scope_team uuid,
  p_include_visible_all boolean,
  p_q text,
  p_category_id uuid,
  p_category_ungrouped boolean,
  p_status text,
  p_visible text,
  p_focus_id uuid,
  p_page integer,
  p_page_size integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
WITH
params AS (
  SELECT
    NULLIF(btrim(COALESCE(p_q, '')), '') AS q,
    GREATEST(COALESCE(p_page, 1), 1) AS requested_page,
    LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 50) AS page_size
),
visible_workflows AS (
  SELECT w.*
  FROM public.workflows AS w
  WHERE
    p_can_read_all
    OR (p_include_visible_all AND w.visible_to = 'all')
    OR EXISTS (
      SELECT 1
      FROM public.resource_permissions AS rp
      WHERE rp.resource_type = 'workflow'
        AND rp.resource_id = w.id
        AND (
          (p_scope_org IS NOT NULL AND (
            (rp.scope_type = 'org' AND rp.scope_id = p_scope_org)
            OR (rp.scope_type = 'dept' AND EXISTS (
              SELECT 1 FROM public.departments AS d
              WHERE d.id::text = rp.scope_id AND d.tenant_code = p_scope_org
            ))
            OR (rp.scope_type = 'team' AND EXISTS (
              SELECT 1 FROM public.teams AS t
              WHERE t.id::text = rp.scope_id AND t.tenant_code = p_scope_org
            ))
          ))
          OR (p_scope_dept IS NOT NULL AND (
            (rp.scope_type = 'dept' AND rp.scope_id = p_scope_dept::text)
            OR (rp.scope_type = 'team' AND EXISTS (
              SELECT 1 FROM public.teams AS t
              WHERE t.id::text = rp.scope_id AND t.dept_id = p_scope_dept
            ))
          ))
          OR (p_scope_team IS NOT NULL
            AND rp.scope_type = 'team'
            AND rp.scope_id = p_scope_team::text)
        )
    )
),
stats_base AS (
  SELECT w.*
  FROM visible_workflows AS w
  CROSS JOIN params AS p
  WHERE
    (
      p.q IS NULL
      OR w.name ILIKE '%' || p.q || '%'
      OR w.description ILIKE '%' || p.q || '%'
      OR EXISTS (
        SELECT 1
        FROM public.workflow_categories AS wc
        JOIN public.wf_categories AS c ON c.id = wc.category_id
        WHERE wc.workflow_id = w.id
          AND c.name ILIKE '%' || p.q || '%'
      )
    )
    AND (
      COALESCE(p_status, '') = ''
      OR (p_status = 'enabled' AND w.enabled)
      OR (p_status = 'disabled' AND NOT w.enabled)
    )
    AND (
      COALESCE(p_visible, '') = ''
      OR (p_visible IN ('all', 'org_only', 'personal_only', 'custom') AND w.visible_to = p_visible)
      OR (
        p_visible IN ('custom:org', 'custom:dept', 'custom:team')
        AND w.visible_to = 'custom'
        AND EXISTS (
          SELECT 1
          FROM public.resource_permissions AS vrp
          WHERE vrp.resource_type = 'workflow'
            AND vrp.resource_id = w.id
            AND vrp.scope_type = split_part(p_visible, ':', 2)
        )
      )
    )
),
page_base AS (
  SELECT sb.*
  FROM stats_base AS sb
  WHERE (
    COALESCE(p_category_ungrouped, false)
    AND NOT EXISTS (
      SELECT 1
      FROM public.workflow_categories AS wc
      WHERE wc.workflow_id = sb.id
    )
  )
  OR (
    NOT COALESCE(p_category_ungrouped, false)
    AND (
      p_category_id IS NULL
      OR EXISTS (
      SELECT 1
      FROM public.workflow_categories AS wc
      WHERE wc.workflow_id = sb.id
        AND wc.category_id = p_category_id
      )
    )
  )
),
ranked AS (
  SELECT
    pb.*,
    row_number() OVER (ORDER BY pb.sort_order ASC, pb.id ASC) AS row_num,
    count(*) OVER () AS page_total
  FROM page_base AS pb
),
focus_position AS (
  SELECT r.row_num
  FROM ranked AS r
  WHERE p_focus_id IS NOT NULL AND r.id = p_focus_id
  LIMIT 1
),
resolved AS (
  SELECT
    p.page_size,
    p.requested_page,
    fp.row_num AS focus_row,
    CASE
      WHEN fp.row_num IS NOT NULL
        THEN ((fp.row_num - 1) / p.page_size) + 1
      ELSE LEAST(
        p.requested_page,
        GREATEST(
          1,
          ((SELECT count(*) FROM ranked) + p.page_size - 1) / p.page_size
        )
      )
    END AS effective_page
  FROM params AS p
  LEFT JOIN focus_position AS fp ON true
),
page_rows AS (
  SELECT r.*
  FROM ranked AS r
  CROSS JOIN resolved AS x
  WHERE r.row_num > (x.effective_page - 1) * x.page_size
    AND r.row_num <= x.effective_page * x.page_size
  ORDER BY r.sort_order ASC, r.id ASC
),
category_counts AS (
  SELECT wc.category_id, count(DISTINCT sb.id)::bigint AS item_count
  FROM stats_base AS sb
  JOIN public.workflow_categories AS wc ON wc.workflow_id = sb.id
  GROUP BY wc.category_id
)
SELECT jsonb_build_object(
  'contractVersion', 2,
  'data', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'description', pr.description,
        'category', pr.category,
        'sort_order', pr.sort_order,
        'enabled', pr.enabled,
        'visible_to', pr.visible_to,
        'created_at', pr.created_at,
        'created_by', pr.created_by,
        'created_by_role', pr.created_by_role,
        'categoryIds', COALESCE((
          SELECT jsonb_agg(wc.category_id ORDER BY wc.category_id)
          FROM public.workflow_categories AS wc
          WHERE wc.workflow_id = pr.id
        ), '[]'::jsonb),
        'workflow_steps', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ws.id,
              'step_order', ws.step_order,
              'title', ws.title,
              'description', ws.description,
              'exec_type', ws.exec_type,
              'agent_id', ws.agent_id,
              'button_text', ws.button_text,
              'enabled', ws.enabled
            )
            ORDER BY ws.step_order ASC, ws.id ASC
          )
          FROM public.workflow_steps AS ws
          WHERE ws.workflow_id = pr.id
        ), '[]'::jsonb),
        'permissions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object('scope_type', rp.scope_type, 'scope_id', rp.scope_id)
            ORDER BY rp.scope_type ASC, rp.scope_id ASC NULLS FIRST
          )
          FROM public.resource_permissions AS rp
          WHERE rp.resource_type = 'workflow'
            AND rp.resource_id = pr.id
        ), '[]'::jsonb)
      )
      ORDER BY pr.sort_order ASC, pr.id ASC
    )
    FROM page_rows AS pr
  ), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', (SELECT effective_page FROM resolved),
    'pageSize', (SELECT page_size FROM resolved),
    'total', COALESCE((SELECT max(page_total) FROM ranked), 0),
    'focusFound', EXISTS (SELECT 1 FROM focus_position),
    'focusPage', CASE
      WHEN EXISTS (SELECT 1 FROM focus_position)
        THEN (SELECT effective_page FROM resolved)
      ELSE NULL
    END
  ),
  'stats', jsonb_build_object(
    'total', (SELECT count(*) FROM stats_base),
    'ungrouped', (
      SELECT count(*)
      FROM stats_base AS sb
      WHERE NOT EXISTS (
        SELECT 1 FROM public.workflow_categories AS wc
        WHERE wc.workflow_id = sb.id
      )
    ),
    'categoryCounts', COALESCE((
      SELECT jsonb_object_agg(cc.category_id::text, cc.item_count)
      FROM category_counts AS cc
    ), '{}'::jsonb)
  )
);
$function$;

REVOKE ALL ON FUNCTION public.admin_workflow_page(
  boolean, text, uuid, uuid, boolean, text, uuid, boolean, text, text, uuid, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_workflow_page(
  boolean, text, uuid, uuid, boolean, text, uuid, boolean, text, text, uuid, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
