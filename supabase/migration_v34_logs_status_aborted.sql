-- 5.14up Day 0 前置 · logs.status 扩展为 ('success', 'error', 'aborted')
--
-- 背景：
--   app/api/agents/[id]/chat/route.ts:406 已写 status: wasAborted ? "aborted" : "error"
--   但 schema.sql:110 的 CHECK 只允许 ('success', 'error')，
--   导致 aborted 写入时违反约束、insert 失败被 try/finally 吞掉，
--   用户中断的对话根本没有日志。这是一个已存在的 silent bug。
--
-- 修复：删旧 CHECK + 加新 CHECK
--
-- 风险：
--   - 已有数据全部是 'success' 或 'error'，新 CHECK 兼容
--   - 不影响任何 SELECT 查询
--   - 5.14up 智能体搭建器的 test-chat 也会用 'aborted' 状态，必须先做

ALTER TABLE logs DROP CONSTRAINT IF EXISTS logs_status_check;
ALTER TABLE logs ADD CONSTRAINT logs_status_check
  CHECK (status IN ('success', 'error', 'aborted'));
