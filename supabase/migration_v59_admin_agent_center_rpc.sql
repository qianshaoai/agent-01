-- v59 · 7.23up
-- 新增 Agent Center 数据库筛选、统计和分页 RPC。
-- 不迁移业务数据；依赖 v57 agent_effective_admin_scopes。
-- SECURITY INVOKER；仅 service_role 可执行，浏览器角色无执行权。

CREATE OR REPLACE FUNCTION public.admin_agent_center_page(
  p_tenant_code text,
  p_can_read_all boolean,
  p_can_read_org boolean,
  p_can_update_all boolean,
  p_can_update_org boolean,
  p_can_enable_all boolean,
  p_can_enable_org boolean,
  p_can_delete_all boolean,
  p_can_delete_org boolean,
  p_q text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_category_id text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $function$
WITH visible_agents AS (
  SELECT
    a.id,
    a.agent_code,
    a.name,
    a.description,
    a.platform,
    a.agent_type,
    a.external_url,
    a.enabled,
    a.category_id,
    a.published_from_draft_id,
    a.created_by_role,
    a.created_at,
    scope_check.within_org,
    CASE
      WHEN a.agent_type = 'external' THEN 'external_link'
      WHEN a.published_from_draft_id IS NOT NULL THEN 'builtin'
      ELSE 'external_api'
    END AS source,
    CASE WHEN a.enabled THEN 'published' ELSE 'disabled' END AS status
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
base AS (
  SELECT va.*
  FROM visible_agents AS va
  WHERE (
      NULLIF(BTRIM(p_q), '') IS NULL
      OR va.name ILIKE '%' || BTRIM(p_q) || '%'
      OR va.id::text ILIKE '%' || BTRIM(p_q) || '%'
      OR va.agent_code ILIKE '%' || BTRIM(p_q) || '%'
      OR va.description ILIKE '%' || BTRIM(p_q) || '%'
      OR va.platform ILIKE '%' || BTRIM(p_q) || '%'
      OR EXISTS (
        SELECT 1
        FROM public.agent_categories AS ac_search
        JOIN public.categories AS c_search
          ON c_search.id = ac_search.category_id
        WHERE ac_search.agent_id = va.id
          AND c_search.name ILIKE '%' || BTRIM(p_q) || '%'
      )
      OR (
        NOT EXISTS (
          SELECT 1
          FROM public.agent_categories AS ac_any
          WHERE ac_any.agent_id = va.id
        )
        AND EXISTS (
          SELECT 1
          FROM public.categories AS c_primary
          WHERE c_primary.id = va.category_id
            AND c_primary.name ILIKE '%' || BTRIM(p_q) || '%'
        )
      )
    )
    AND (NULLIF(BTRIM(p_source), '') IS NULL OR va.source = p_source)
    AND (NULLIF(BTRIM(p_platform), '') IS NULL OR va.platform = p_platform)
),
category_filtered AS (
  SELECT b.*
  FROM base AS b
  WHERE
    NULLIF(BTRIM(p_category_id), '') IS NULL
    OR (
      p_category_id = '__ungrouped__'
      AND b.category_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agent_categories AS ac_ungrouped
        WHERE ac_ungrouped.agent_id = b.id
      )
    )
    OR (
      p_category_id <> '__ungrouped__'
      AND (
        EXISTS (
          SELECT 1
          FROM public.agent_categories AS ac_filter
          WHERE ac_filter.agent_id = b.id
            AND ac_filter.category_id::text = p_category_id
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM public.agent_categories AS ac_any
            WHERE ac_any.agent_id = b.id
          )
          AND b.category_id::text = p_category_id
        )
      )
    )
),
fully_filtered AS (
  SELECT cf.*
  FROM category_filtered AS cf
  WHERE NULLIF(BTRIM(p_status), '') IS NULL OR cf.status = p_status
),
paged AS (
  SELECT ff.*
  FROM fully_filtered AS ff
  ORDER BY ff.created_at DESC, ff.id
  OFFSET (GREATEST(p_page, 1) - 1) * LEAST(GREATEST(p_page_size, 1), 100)
  LIMIT LEAST(GREATEST(p_page_size, 1), 100)
),
page_items AS (
  SELECT
    p.created_at AS sort_at,
    jsonb_build_object(
      'rowKind', 'agent',
      'id', 'agent:' || p.id::text,
      'agentId', p.id,
      'draftId', p.published_from_draft_id,
      'agentCode', p.agent_code,
      'name', p.name,
      'description', p.description,
      'source', p.source,
      'status', p.status,
      'draftStatus', NULL,
      'platform', p.platform,
      'externalUrl', p.external_url,
      'categoryIds', COALESCE(category_data.category_ids, '[]'::jsonb),
      'categories', COALESCE(category_data.categories, '[]'::jsonb),
      'knowledgeBases', COALESCE(kb_data.items, '[]'::jsonb),
      'workflows', COALESCE(workflow_data.items, '[]'::jsonb),
      'knowledgeBaseCount', COALESCE(kb_data.item_count, 0),
      'workflowRefCount', COALESCE(workflow_data.item_count, 0),
      'conversationCount', COALESCE(conversation_data.item_count, 0),
      'updatedAt', p.created_at,
      'canEdit',
        p_can_update_all
        OR (p_can_update_org AND p_tenant_code IS NOT NULL AND p.within_org),
      'canEnable',
        p_can_enable_all
        OR (p_can_enable_org AND p_tenant_code IS NOT NULL AND p.within_org),
      'canDelete',
        p_can_delete_all
        OR (p_can_delete_org AND p_tenant_code IS NOT NULL AND p.within_org)
    ) AS item
  FROM paged AS p
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(ec.category_id ORDER BY ec.sort_order, ec.category_id) AS category_ids,
      jsonb_agg(
        jsonb_build_object(
          'id', ec.category_id,
          'name', ec.name,
          'iconUrl', ec.icon_url
        )
        ORDER BY ec.sort_order, ec.category_id
      ) AS categories
    FROM (
      SELECT c.id AS category_id, c.name, c.icon_url, c.sort_order
      FROM public.agent_categories AS ac
      JOIN public.categories AS c
        ON c.id = ac.category_id
      WHERE ac.agent_id = p.id

      UNION ALL

      SELECT c.id, c.name, c.icon_url, c.sort_order
      FROM public.categories AS c
      WHERE c.id = p.category_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.agent_categories AS ac_any
          WHERE ac_any.agent_id = p.id
        )
    ) AS ec
  ) AS category_data ON true
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object('id', refs.id, 'name', refs.name)
        ORDER BY refs.name, refs.id
      ) AS items,
      COUNT(*)::integer AS item_count
    FROM (
      SELECT DISTINCT kb.id, kb.name
      FROM public.agent_knowledge_bases AS akb
      JOIN public.knowledge_bases AS kb
        ON kb.id = akb.kb_id
      WHERE akb.agent_id = p.id
    ) AS refs
  ) AS kb_data ON true
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object('id', refs.id, 'name', refs.name)
        ORDER BY refs.name, refs.id
      ) AS items,
      COUNT(*)::integer AS item_count
    FROM (
      SELECT DISTINCT w.id, w.name
      FROM public.workflow_steps AS ws
      JOIN public.workflows AS w
        ON w.id = ws.workflow_id
      WHERE ws.agent_id = p.id
    ) AS refs
  ) AS workflow_data ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS item_count
    FROM public.conversations AS conv
    WHERE conv.agent_id = p.id
  ) AS conversation_data ON true
)
SELECT jsonb_build_object(
  'data',
    COALESCE(
      (SELECT jsonb_agg(pi.item ORDER BY pi.sort_at DESC) FROM page_items AS pi),
      '[]'::jsonb
    ),
  'pagination',
    jsonb_build_object(
      'page', GREATEST(p_page, 1),
      'pageSize', LEAST(GREATEST(p_page_size, 1), 100),
      'total', (SELECT COUNT(*)::bigint FROM fully_filtered)
    ),
  'stats',
    jsonb_build_object(
      'total', (SELECT COUNT(*)::bigint FROM base),
      'published', (SELECT COUNT(*)::bigint FROM base WHERE status = 'published'),
      'disabled', (SELECT COUNT(*)::bigint FROM base WHERE status = 'disabled'),
      'workflowReferenced',
        (
          SELECT COUNT(*)::bigint
          FROM base AS b
          WHERE EXISTS (
            SELECT 1
            FROM public.workflow_steps AS ws
            WHERE ws.agent_id = b.id
          )
        ),
      'ungrouped',
        (
          SELECT COUNT(*)::bigint
          FROM base AS b
          WHERE b.category_id IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.agent_categories AS ac
              WHERE ac.agent_id = b.id
            )
        )
    ),
  'categories',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'iconUrl', c.icon_url,
            'count',
              (
                SELECT COUNT(*)::bigint
                FROM base AS b
                WHERE EXISTS (
                  SELECT 1
                  FROM public.agent_categories AS ac
                  WHERE ac.agent_id = b.id
                    AND ac.category_id = c.id
                )
                OR (
                  NOT EXISTS (
                    SELECT 1
                    FROM public.agent_categories AS ac_any
                    WHERE ac_any.agent_id = b.id
                  )
                  AND b.category_id = c.id
                )
              )
          )
          ORDER BY c.sort_order, c.name, c.id
        )
        FROM public.categories AS c
      ),
      '[]'::jsonb
    ),
  'platforms',
    COALESCE(
      (
        SELECT jsonb_agg(platform ORDER BY platform)
        FROM (
          SELECT DISTINCT va.platform
          FROM visible_agents AS va
          WHERE va.platform IS NOT NULL
            AND va.platform <> ''
        ) AS visible_platforms
      ),
      '[]'::jsonb
    )
);
$function$;

REVOKE ALL ON FUNCTION public.admin_agent_center_page(
  text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_agent_center_page(
  text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  text, text, text, text, text, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
