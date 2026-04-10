-- ============================================================
-- 迁移 v11：独立工作流分类表
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 创建独立的工作流分类表 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS wf_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wf_categories DISABLE ROW LEVEL SECURITY;

-- ── 2. 重建 workflow_categories 指向新表（旧数据清空） ──────────
-- 旧表的 category_id 引用 agent 的 categories 表，与工作流分类无关，直接重建
DROP TABLE IF EXISTS workflow_categories;

CREATE TABLE workflow_categories (
  workflow_id  UUID NOT NULL REFERENCES workflows(id)     ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES wf_categories(id) ON DELETE CASCADE,
  PRIMARY KEY  (workflow_id, category_id)
);

ALTER TABLE workflow_categories DISABLE ROW LEVEL SECURITY;
