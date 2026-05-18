-- 配额原子性扣减函数（防止并发超额）
-- 在 Supabase Dashboard > SQL Editor 中执行此文件

CREATE OR REPLACE FUNCTION increment_quota_used(p_code TEXT)
RETURNS boolean AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE tenants
  SET quota_used = quota_used + 1
  WHERE code = p_code AND quota_used < quota;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$ LANGUAGE plpgsql;

-- 5.16up · R5 工作流步骤拖拽改顺序 —— 原子重排
-- 传入完整有序 step id 数组；plpgsql 函数体本身即单事务，要么全成、要么全不动。
-- 返回 false：传入集合与该工作流当前步骤集合不一致（前端须强制刷新真实顺序）。
CREATE OR REPLACE FUNCTION reorder_workflow_steps(p_workflow_id UUID, p_step_ids UUID[])
RETURNS boolean AS $$
DECLARE
  existing_count INT;
  input_count INT;
BEGIN
  input_count := COALESCE(array_length(p_step_ids, 1), 0);

  -- 数量必须与该工作流当前步骤数一致
  SELECT COUNT(*) INTO existing_count FROM workflow_steps WHERE workflow_id = p_workflow_id;
  IF input_count <> existing_count THEN
    RETURN false;
  END IF;

  -- 每个传入 id 必须真实属于该工作流（防越权改别的工作流的步骤）
  IF EXISTS (
    SELECT 1 FROM unnest(p_step_ids) AS sid
    WHERE NOT EXISTS (
      SELECT 1 FROM workflow_steps WHERE id = sid AND workflow_id = p_workflow_id
    )
  ) THEN
    RETURN false;
  END IF;

  -- 原子重排：按数组下标重设 step_order（1, 2, 3 …）
  UPDATE workflow_steps ws
  SET step_order = t.ord
  FROM unnest(p_step_ids) WITH ORDINALITY AS t(sid, ord)
  WHERE ws.id = t.sid AND ws.workflow_id = p_workflow_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;
