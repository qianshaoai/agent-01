-- ============================================================
-- 迁移 v3：工作流与分类多对多关联
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 工作流-分类关联表 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_categories (
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (workflow_id, category_id)
);

-- ── 2. 关闭 RLS（与现有表保持一致）────────────────────────────
ALTER TABLE workflow_categories DISABLE ROW LEVEL SECURITY;
