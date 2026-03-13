-- ============================================================
-- 迁移 v2：新增外链型智能体 + 工作流管理
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 1. 智能体表：新增类型字段和外链 URL ─────────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS agent_type   TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';

-- 约束：agent_type 只能是 chat 或 external
ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_agent_type_check;
ALTER TABLE agents
  ADD CONSTRAINT agents_agent_type_check
  CHECK (agent_type IN ('chat', 'external'));

-- ── 2. 工作流表 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',   -- 分类标签（自由文本）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  -- 可见权限：'all' = 全部用户；否则为英文逗号分隔的 tenant_code 列表
  -- 例如：'DEMO,ACME' 表示只有这两个企业的用户可见
  visible_to  TEXT NOT NULL DEFAULT 'all',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. 工作流步骤表 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_order  INTEGER NOT NULL DEFAULT 1,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 执行类型：agent = 智能体执行；manual = 人工执行
  exec_type   TEXT NOT NULL DEFAULT 'agent'
                CHECK (exec_type IN ('agent', 'manual')),
  agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  button_text TEXT NOT NULL DEFAULT '进入智能体',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workflow_steps_wf_idx
  ON workflow_steps (workflow_id, step_order);

-- ── 4. 关闭 RLS（与现有表保持一致）────────────────────────────
ALTER TABLE workflows      DISABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps DISABLE ROW LEVEL SECURITY;
