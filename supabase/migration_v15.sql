-- ============================================================
-- 迁移 v15：分类图标 + 智能体分类多选
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 智能体分类表加 icon_url ─────────────────────────────────
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- ── 2. 工作流分类表加 icon_url ─────────────────────────────────
ALTER TABLE wf_categories
  ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- ── 3. 智能体 ↔ 分类 多对多连接表 ───────────────────────────────
CREATE TABLE IF NOT EXISTS agent_categories (
  agent_id    UUID NOT NULL REFERENCES agents(id)     ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, category_id)
);

ALTER TABLE agent_categories DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS agent_categories_category_idx ON agent_categories(category_id);

-- ── 4. 迁移旧数据：把现有 agents.category_id 写入连接表 ─────────
INSERT INTO agent_categories (agent_id, category_id)
SELECT id, category_id FROM agents
WHERE category_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 说明：agents.category_id 字段暂时保留以兼容旧查询；
--      新代码应只读写 agent_categories 表，旧字段不再维护。

-- ── 5. 刷新 PostgREST schema cache ─────────────────────────────
NOTIFY pgrst, 'reload schema';
