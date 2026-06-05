-- ============================================================
-- 迁移 v48：resource_permissions → workflow_scope_order 反向同步 trigger
-- 6.3up · R1.9 · 2026-06-03
-- Plan：C:\Users\Admin\.claude\plans\snappy-jumping-pascal.md
--
-- 在 Supabase Dashboard > SQL Editor 中执行此文件（v46 / v47 之后）
--
-- 起因：R1.9 发现 UX 缝隙 ——
--   工作流编辑器「可见权限 = 指定 X 可见」只写 resource_permissions，
--   但「分层级配置」页只读 workflow_scope_order，两条路径对同一份数据没有同步。
--   用户在编辑器把"DEMO 可见"勾上保存后，去配置页选 DEMO scope 找不到该工作流。
--
-- 设计：DB 层 trigger 收口所有反向同步路径 ——
--   AFTER INSERT ON resource_permissions（workflow + org/dept/team）
--     → 自动 INSERT workflow_scope_order（sort_order 接末尾，主键冲突跳过）
--   AFTER DELETE ON resource_permissions
--     → 自动 DELETE 对应 workflow_scope_order 行
--
-- 任何路径（admin 编辑器 / admin/resource-permissions / SDK / curl / 旁路）写
-- workflow 类 permissions 都被自动反向维护到 order 表，无需各 route 手动同步。
--
-- 与 v47 RPC 的协作：
--   v47 `add_workflow_scope_order` 内 CTE 先写 order 后写 perms。
--   trigger 在写 perms 时触发，想反向 INSERT order → 主键已存在 → ON CONFLICT DO NOTHING 跳过。
--   v47 `remove_workflow_scope_order` 先 DELETE order 后 DELETE perms。
--   trigger 在 DELETE perms 时触发，想反向 DELETE order → 已被删 → DELETE 0 行。
--   两者协作正确。
--
-- 一次性 backfill：把已有 permissions 中存在但 order 中缺失的工作流补齐 order 行，
-- 确保 trigger 生效之前历史数据也一致。
-- ============================================================

-- ── 1. trigger function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_workflow_scope_order_from_perms()
RETURNS TRIGGER AS $$
DECLARE
  v_next INT;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- 仅对 workflow 类型 + org/dept/team scope 起作用；其他 scope（user/user_type/all/group）跳过
    IF NEW.resource_type = 'workflow' AND NEW.scope_type IN ('org', 'dept', 'team') THEN
      SELECT COALESCE(MAX(sort_order), -1) + 1
        INTO v_next
        FROM workflow_scope_order
       WHERE scope_type = NEW.scope_type
         AND scope_id   = NEW.scope_id;

      INSERT INTO workflow_scope_order(scope_type, scope_id, workflow_id, sort_order)
      VALUES (NEW.scope_type, NEW.scope_id, NEW.resource_id, v_next)
      ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.resource_type = 'workflow' AND OLD.scope_type IN ('org', 'dept', 'team') THEN
      DELETE FROM workflow_scope_order
       WHERE scope_type  = OLD.scope_type
         AND scope_id    = OLD.scope_id
         AND workflow_id = OLD.resource_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ── 2. drop + recreate trigger（幂等：重复跑 v48 不报错）────────
DROP TRIGGER IF EXISTS tr_resource_perms_sync_scope_order ON resource_permissions;
CREATE TRIGGER tr_resource_perms_sync_scope_order
AFTER INSERT OR DELETE ON resource_permissions
FOR EACH ROW
EXECUTE FUNCTION sync_workflow_scope_order_from_perms();

-- ── 3. 一次性 backfill · 历史孤儿数据修齐 ─────────────────────────
-- 把 resource_permissions 里有但 workflow_scope_order 里没有的 workflow + scope 组合补齐。
-- 同一 (scope_type, scope_id) 内多条用 ROW_NUMBER() 接末尾分配 sort_order。
WITH missing AS (
  SELECT
    p.scope_type,
    p.scope_id,
    p.resource_id AS workflow_id,
    ROW_NUMBER() OVER (PARTITION BY p.scope_type, p.scope_id ORDER BY p.created_at, p.id) AS rn
  FROM resource_permissions p
  WHERE p.resource_type = 'workflow'
    AND p.scope_type IN ('org', 'dept', 'team')
    AND NOT EXISTS (
      SELECT 1 FROM workflow_scope_order o
       WHERE o.scope_type  = p.scope_type
         AND o.scope_id    = p.scope_id
         AND o.workflow_id = p.resource_id
    )
),
base AS (
  SELECT
    m.scope_type,
    m.scope_id,
    m.workflow_id,
    m.rn,
    COALESCE((
      SELECT MAX(sort_order) + 1
        FROM workflow_scope_order o
       WHERE o.scope_type = m.scope_type
         AND o.scope_id   = m.scope_id
    ), 0) AS base_order
  FROM missing m
)
INSERT INTO workflow_scope_order(scope_type, scope_id, workflow_id, sort_order)
SELECT scope_type, scope_id, workflow_id, base_order + (rn - 1)
FROM base
ON CONFLICT DO NOTHING;

-- ── 4. 刷新 PostgREST schema 缓存 ──────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 验证 SQL（可重复执行）
-- ============================================================
-- 1. 看 trigger 已挂载
-- SELECT tgname FROM pg_trigger WHERE tgname = 'tr_resource_perms_sync_scope_order';
--
-- 2. 看一致性（应返回 0 行）：有 perm 无 order 的 workflow
-- SELECT p.scope_type, p.scope_id, p.resource_id
-- FROM resource_permissions p
-- WHERE p.resource_type = 'workflow' AND p.scope_type IN ('org','dept','team')
--   AND NOT EXISTS (
--     SELECT 1 FROM workflow_scope_order o
--      WHERE o.scope_type = p.scope_type AND o.scope_id = p.scope_id AND o.workflow_id = p.resource_id
--   );
--
-- 3. 手测：INSERT 一条 perm → 自动多一条 order
-- INSERT INTO resource_permissions(resource_type, resource_id, scope_type, scope_id)
-- VALUES ('workflow', '<某 workflow id>', 'org', 'DEMO');
-- SELECT * FROM workflow_scope_order WHERE scope_type='org' AND scope_id='DEMO';
