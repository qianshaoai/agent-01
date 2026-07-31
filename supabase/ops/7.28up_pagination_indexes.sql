-- 7.28up 候选索引。
-- 先用 EXPLAIN (ANALYZE, BUFFERS) 记录基线，只创建能改善实际执行计划的项。
-- CREATE INDEX CONCURRENTLY 不能放进事务。

CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_name_id_idx
  ON public.agents(name, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflows_sort_order_id_idx
  ON public.workflows(sort_order, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_categories_category_workflow_idx
  ON public.workflow_categories(category_id, workflow_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_permissions_type_scope_resource_idx
  ON public.resource_permissions(resource_type, scope_type, scope_id, resource_id);
