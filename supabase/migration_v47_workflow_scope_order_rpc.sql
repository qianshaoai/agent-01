-- ============================================================
-- 迁移 v47：工作流分层级配置 · 增/删 RPC（事务化 P1 一体写入）
-- 6.3up · R1.2 Finding 4 · 2026-06-03
-- Plan：C:\Users\Admin\.claude\plans\snappy-jumping-pascal.md
--
-- 在 Supabase Dashboard > SQL Editor 中执行此文件（v46 之后）
--
-- 修复：v46 的 POST / DELETE 在 route 层分两步写两张表（先 order 后 permissions），
-- 中间失败或并发撞车会留下"有排序无可见"或"可见无排序"半成功状态。
-- 本 migration 把 add / remove 也封进 PL/pgSQL，与 batch_reorder_workflow_scope 同口径。
-- ============================================================

-- ── 1. add_workflow_scope_order · 批量增（同步写两张表 · 幂等）─────
-- 行为：
--   - 计算当前 scope 末尾的 sort_order，依传入 workflow_id 数组顺序往后接
--   - 已存在的 (scope_type, scope_id, workflow_id) 主键自动跳过（NOT EXISTS 守卫）
--   - 同步写 resource_permissions(resource_type='workflow', scope_type, scope_id, resource_id)
--     依赖 v8 的唯一索引 resource_permissions_unique_idx 走 ON CONFLICT DO NOTHING
--   - 返回 INT = 本次实际新增的 order 行数
-- 调用方约定 p_workflow_ids 已校验：workflow 存在且非 personal_only（route 层做）
CREATE OR REPLACE FUNCTION add_workflow_scope_order(
  p_scope_type   TEXT,
  p_scope_id     TEXT,
  p_workflow_ids UUID[]
) RETURNS INT AS $$
DECLARE
  v_added INT := 0;
  v_next  INT;
BEGIN
  IF p_scope_type NOT IN ('org', 'dept', 'team') THEN
    RAISE EXCEPTION 'invalid scope_type: %', p_scope_type;
  END IF;
  IF p_workflow_ids IS NULL OR array_length(p_workflow_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1
    INTO v_next
    FROM workflow_scope_order
   WHERE scope_type = p_scope_type
     AND scope_id   = p_scope_id;

  WITH ins_order AS (
    INSERT INTO workflow_scope_order(scope_type, scope_id, workflow_id, sort_order)
    SELECT p_scope_type, p_scope_id, t.wid, v_next + (t.idx - 1)::INT
      FROM unnest(p_workflow_ids) WITH ORDINALITY AS t(wid, idx)
     WHERE NOT EXISTS (
        SELECT 1 FROM workflow_scope_order o
         WHERE o.scope_type  = p_scope_type
           AND o.scope_id    = p_scope_id
           AND o.workflow_id = t.wid
     )
    RETURNING workflow_id
  ),
  ins_perm AS (
    INSERT INTO resource_permissions(resource_type, resource_id, scope_type, scope_id)
    SELECT 'workflow', ins_order.workflow_id, p_scope_type, p_scope_id
      FROM ins_order
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_added FROM ins_order;

  RETURN v_added;
END;
$$ LANGUAGE plpgsql;


-- ── 2. remove_workflow_scope_order · 单个删（同步删两张表 · 幂等）────
-- 行为：
--   - 删 workflow_scope_order 对应行
--   - 删 resource_permissions 对应行（仅删与本 scope 完全匹配的那条；不影响其他 scope）
--   - 不存在时无副作用
CREATE OR REPLACE FUNCTION remove_workflow_scope_order(
  p_scope_type  TEXT,
  p_scope_id    TEXT,
  p_workflow_id UUID
) RETURNS VOID AS $$
BEGIN
  IF p_scope_type NOT IN ('org', 'dept', 'team') THEN
    RAISE EXCEPTION 'invalid scope_type: %', p_scope_type;
  END IF;

  DELETE FROM workflow_scope_order
   WHERE scope_type  = p_scope_type
     AND scope_id    = p_scope_id
     AND workflow_id = p_workflow_id;

  DELETE FROM resource_permissions
   WHERE resource_type = 'workflow'
     AND resource_id   = p_workflow_id
     AND scope_type    = p_scope_type
     AND scope_id      = p_scope_id;
END;
$$ LANGUAGE plpgsql;


-- ── 3. 刷新 PostgREST schema 缓存 ──────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 验证 SQL（可重复执行）
-- ============================================================
-- SELECT add_workflow_scope_order('org', 'NOOP', ARRAY[]::uuid[]);  -- 期望 0
-- SELECT remove_workflow_scope_order('org', 'NOOP', '00000000-0000-0000-0000-000000000000'::uuid);  -- 期望无错
