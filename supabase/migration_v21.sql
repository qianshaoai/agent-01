-- migration_v21: 历史 deleted 用户数据释放账号字段
-- 只处理 status = 'deleted' 的用户，把 username/phone 改写成墓碑值，
-- 释放原账号信息以便后续重新注册复用。
-- 不处理 cancelled，不动非删除用户。
-- SQL 幂等：再次执行时 username/phone 已是墓碑值，不会重复改写。

UPDATE users
SET
  username = 'deleted_' || id,
  phone    = 'del_' || id,
  nickname = '已删除用户'
WHERE status = 'deleted'
  AND (username IS NULL OR username NOT LIKE 'deleted_%' OR phone NOT LIKE 'del_%');
