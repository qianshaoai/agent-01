-- ============================================================================
-- migration_v26 · 5.7up · GPT 接入阶段二（历史摘要降本）
-- 改动表：conversations（+2 列）
-- 数据迁移：无（全部新建可空字段）
-- 跑法：Supabase Dashboard > SQL Editor 整段粘贴执行（幂等可重跑）
-- ============================================================================

-- 5.7up · 阶段二：滑动窗口 + 增量摘要
-- summary_text：当前对话的"老历史摘要"（递增维护，由便宜模型生成）
-- summary_until_at：摘要已涵盖到的最后一条消息时间戳；下次只摘 created_at > 它的"新冒出来的老消息"
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary_text TEXT,
  ADD COLUMN IF NOT EXISTS summary_until_at TIMESTAMPTZ;
