-- ============================================================
-- 迁移 v46：工作流分层级配置（组织 / 部门 / 小组）排序表 + RPC
-- 6.3up · R1.1 · 2026-06-03
-- 方案：upgrade/6.3up/方案-工作流分层级配置-20260603.md
-- Plan：C:\Users\Admin\.claude\plans\snappy-jumping-pascal.md
--
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- 与 resource_permissions（管"可见性"）配对：本表只管"在该层级的排序"。
-- 路径 P1：管理员"拉取"工作流到层级 = 同步写 resource_permissions + workflow_scope_order。
-- ============================================================

-- ── 1. 排序表 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_scope_order (
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('org', 'dept', 'team')),
  -- scope_id 类型与 resource_permissions.scope_id 对齐：
  --   org  → tenant_code (TEXT)
  --   dept → departments.id UUID 转 TEXT
  --   team → teams.id UUID 转 TEXT
  scope_id    TEXT NOT NULL,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_type, scope_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS wf_scope_order_workflow_idx
  ON workflow_scope_order (workflow_id);

CREATE INDEX IF NOT EXISTS wf_scope_order_scope_idx
  ON workflow_scope_order (scope_type, scope_id, sort_order);

ALTER TABLE workflow_scope_order DISABLE ROW LEVEL SECURITY;

-- ── 2. RPC · 用户维度的层级回退取排序 ──────────────────────────────
-- 优先级：team > dept > org（同一 workflow_id 只取最具体层级的 sort_order）
CREATE OR REPLACE FUNCTION get_user_workflow_order(p_user_id UUID)
RETURNS TABLE(workflow_id UUID, sort_order INT, scope TEXT) AS $$
  WITH u AS (
    SELECT id, tenant_code, dept_id, team_id
    FROM users
    WHERE id = p_user_id
  )
  SELECT DISTINCT ON (o.workflow_id)
    o.workflow_id,
    o.sort_order,
    o.scope_type AS scope
  FROM workflow_scope_order o
  CROSS JOIN u
  WHERE
    (o.scope_type = 'team' AND u.team_id IS NOT NULL AND u.team_id::text = o.scope_id) OR
    (o.scope_type = 'dept' AND u.dept_id IS NOT NULL AND u.dept_id::text = o.scope_id) OR
    (o.scope_type = 'org'  AND u.tenant_code IS NOT NULL AND u.tenant_code = o.scope_id)
  ORDER BY
    o.workflow_id,
    CASE o.scope_type
      WHEN 'team' THEN 1
      WHEN 'dept' THEN 2
      WHEN 'org'  THEN 3
    END;
$$ LANGUAGE sql STABLE;

-- ── 3. RPC · 批量重排（事务）──────────────────────────────────────
-- 用 DELETE + INSERT 替代 UPSERT，避免主键冲突；统一在事务内完成。
-- p_ordered_ids 顺序即新 sort_order（0-based）。
CREATE OR REPLACE FUNCTION batch_reorder_workflow_scope(
  p_scope_type TEXT,
  p_scope_id   TEXT,
  p_ordered_ids UUID[]
) RETURNS VOID AS $$
BEGIN
  IF p_scope_type NOT IN ('org', 'dept', 'team') THEN
    RAISE EXCEPTION 'invalid scope_type: %', p_scope_type;
  END IF;

  DELETE FROM workflow_scope_order
  WHERE scope_type = p_scope_type
    AND scope_id   = p_scope_id;

  IF p_ordered_ids IS NOT NULL AND array_length(p_ordered_ids, 1) > 0 THEN
    INSERT INTO workflow_scope_order (scope_type, scope_id, workflow_id, sort_order)
    SELECT p_scope_type, p_scope_id, id, (idx - 1)
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS t(id, idx);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── 4. 刷新 PostgREST schema 缓存 ──────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 验证 SQL（可重复执行）
-- ============================================================
-- SELECT * FROM workflow_scope_order LIMIT 1;
-- SELECT * FROM get_user_workflow_order('00000000-0000-0000-0000-000000000000'::uuid);
-- 期望：第一条返回空集（表已建）；第二条返回空集（无用户匹配）。
