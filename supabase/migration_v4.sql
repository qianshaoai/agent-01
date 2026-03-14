-- Migration v4: system_settings + category_agent_display + user_agents
-- Run this in Supabase SQL Editor

-- ── 1. 系统设置表（品牌配置） ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 初始化默认值
INSERT INTO system_settings (key, value) VALUES
  ('logo_url',       ''),
  ('platform_name',  'AI 智能体平台')
ON CONFLICT (key) DO NOTHING;

-- ── 2. 分类-智能体展示覆盖表（手工增补/隐藏） ──────────────────────
-- 工作流来源的智能体动态计算，不存入此表
-- is_manual=true  : 后台手动加入，即使不在任何工作流步骤中也显示
-- is_hidden=true  : 后台手动隐藏，即使在工作流步骤中也不显示
CREATE TABLE IF NOT EXISTS category_agent_display (
  category_id  UUID NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES agents(id)      ON DELETE CASCADE,
  is_manual    BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category_id, agent_id)
);

-- ── 3. 用户个人智能体表 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  agent_type   TEXT NOT NULL DEFAULT 'chat' CHECK (agent_type IN ('chat', 'external')),
  -- chat 类型配置
  platform     TEXT NOT NULL DEFAULT 'openai',
  api_url      TEXT NOT NULL DEFAULT '',
  api_key_enc  TEXT NOT NULL DEFAULT '',
  model_params JSONB NOT NULL DEFAULT '{}',
  -- external 类型配置
  external_url TEXT NOT NULL DEFAULT '',
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_agents_user_id_idx ON user_agents(user_id);
