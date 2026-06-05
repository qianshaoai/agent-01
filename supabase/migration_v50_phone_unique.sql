-- 6.5up · v50 · 一个手机号锁一个有效用户
--
-- 背景
--   schema.sql:31 的复合 UNIQUE (phone, tenant_code) 保留 —— 仍然防同组织
--   同手机号重复，但允许同手机号跨多个组织各注册一次。
--   6.5up 新需求："每个手机号也锁死一个用户，其他用户用同号注册即提示"。
--   → 加 partial unique index：仅 status IN ('active', 'disabled') 的 row
--     在 phone 上全表唯一。
--   软删除 / 注销（status IN ('deleted', 'cancelled')）的 row 不占名额，
--   原主人后续重新注册可复用该号；与现有 register/route.ts 在用户名 /
--   phone+tenant 校验时的过滤范围（in ['active', 'disabled']）一致，
--   避免语义割裂。
--
-- 上线前置
--   prod 必须先确保没有 active+disabled 重复行。排查 SQL：
--     SELECT phone, COUNT(*)
--     FROM users
--     WHERE status IN ('active', 'disabled')
--     GROUP BY phone
--     HAVING COUNT(*) > 1;
--   如果非空 → 必须先清理（保留最早 / 最近登录的一条，其他改 status='deleted'）
--   再跑本 migration，否则 CREATE INDEX 会因索引行重复而失败。
--
-- 回滚
--   DROP INDEX IF EXISTS users_phone_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_active_unique
  ON users (phone)
  WHERE status IN ('active', 'disabled');

NOTIFY pgrst, 'reload schema';
