-- 7.23up · 索引上线前后执行计划取证模板（只读）
-- 将 :agent_id 替换为会话/引用数量较多的真实智能体 UUID。

EXPLAIN (ANALYZE, BUFFERS, WAL)
SELECT COUNT(*)
FROM public.conversations
WHERE agent_id = :'agent_id';

EXPLAIN (ANALYZE, BUFFERS, WAL)
SELECT COUNT(DISTINCT workflow_id)
FROM public.workflow_steps
WHERE agent_id = :'agent_id';

EXPLAIN (ANALYZE, BUFFERS, WAL)
SELECT COUNT(DISTINCT kb_id)
FROM public.agent_knowledge_bases
WHERE agent_id = :'agent_id';

