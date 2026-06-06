-- 6.4up R2 Fix 1 · workflows.created_by drop FK
-- 来源：upgrade/6.4up/方案-权限管理-20260604.md（R2 验收 P0-1 修复）
-- 起因：6.3up 的 v49 已经为同款问题 drop 过该 FK，但 6.3up 还未合 master2，
--      6.4up 基于 master2 → 仍带 v31 的 FK to admins(id)。
--      custom admin actorId 是 users.id，写入 workflows.created_by 会撞 FK 23503。
--
-- 与 v49 语义等价；6.3up 合 master2 后两条迁移幂等共存。
--
-- 小B R2.1 加固：不赌约束名，按"指向 workflows.created_by 列的全部 FK"循环 drop。
-- 这样即使线上约束名漂移（历史改名 / pg_dump 改名 / 手动重建）也能修。
--
-- 幂等：FOR 循环 + DROP CONSTRAINT IF EXISTS；重复跑安全。

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class           cls ON cls.oid = con.conrelid
    JOIN pg_namespace       nsp ON nsp.oid = cls.relnamespace
    JOIN pg_attribute       att ON att.attrelid = con.conrelid
                                AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND cls.relname = 'workflows'
      AND att.attname = 'created_by'
  LOOP
    EXECUTE format('ALTER TABLE workflows DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped FK: %', r.conname;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
