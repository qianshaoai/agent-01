-- 7.23up · Agent Center 缺失索引上线脚本
--
-- 重要：
-- 1. 必须逐条在非事务会话执行；不要包在 BEGIN/COMMIT 中。
-- 2. 执行前后使用 7.23up_explain.sql 保存执行计划。
-- 3. 生产执行期间监控 pg_stat_progress_create_index、锁等待、CPU、复制延迟。

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_agent_id_idx
  ON public.conversations(agent_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_steps_agent_id_idx
  ON public.workflow_steps(agent_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_knowledge_bases_agent_id_idx
  ON public.agent_knowledge_bases(agent_id);

