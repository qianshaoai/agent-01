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
