-- 5.14up PR-B · 智能体搭建器骨架
--
-- 新增 agent_drafts 表（草稿表）+ 给 agents 表加 3 列：
--   provider_id              引用模型供应商（替代旧的智能体自带 api_key_enc 路径，PR-D 兼容）
--   builder_config           搭建器配置（system_prompt / opening_message / suggested_questions / capabilities 等）
--   published_from_draft_id  反查这个正式智能体是哪个草稿发布出来的（PR-C publish 写入）
--
-- 流程：
--   超级管理员在 /admin/agent-builder 新建草稿
--   → 配置基础信息 / 模型设置 / 提示词 / 对话体验 / 发布设置
--   → 保存为 draft 状态
--   → （PR-C）测试聊天 → status=testing
--   → （PR-C）发布 → status=published + 写入 agents 表（默认 enabled=false，PR-D 上线后再启用）
--
-- 注意顺序：先建 agent_drafts，再 ALTER agents 加 published_from_draft_id（外键依赖）

-- ─── 1. agent_drafts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL, -- 由现有 agent "复制为草稿"时填
  name                TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  category_ids        JSONB NOT NULL DEFAULT '[]'::jsonb, -- string[] of category ids
  provider_id         UUID REFERENCES model_providers(id) ON DELETE SET NULL,
  agent_type          TEXT NOT NULL DEFAULT 'chat' CHECK (agent_type IN ('chat', 'external')),
  external_url        TEXT NOT NULL DEFAULT '',
  -- 搭建器配置（system_prompt / opening_message / suggested_questions / capabilities / business_rules ...）
  builder_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 模型参数（temperature / max_tokens / 厂商特殊参数）
  model_params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 可见范围配置（默认 owner_only，发布时由 super_admin 在 UI 选择扩大）
  visibility_config   JSONB NOT NULL DEFAULT '{"visible_to":"owner_only","scope":[]}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'published', 'archived')),
  published_agent_id  UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_by          UUID,
  updated_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_drafts_status_idx       ON agent_drafts(status);
CREATE INDEX IF NOT EXISTS agent_drafts_created_by_idx   ON agent_drafts(created_by);
CREATE INDEX IF NOT EXISTS agent_drafts_provider_id_idx  ON agent_drafts(provider_id);

ALTER TABLE agent_drafts DISABLE ROW LEVEL SECURITY;

-- ─── 2. agents 表加 3 列 ───────────────────────────────────────────────────
-- 老智能体保持 provider_id = NULL，依赖自带 api_key_enc 走兼容路径（PR-D 处理）
-- 新草稿发布的智能体 provider_id 非空，chat route 按 provider 取 key
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS provider_id              UUID REFERENCES model_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS builder_config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS published_from_draft_id  UUID REFERENCES agent_drafts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agents_provider_id_idx              ON agents(provider_id);
CREATE INDEX IF NOT EXISTS agents_published_from_draft_id_idx  ON agents(published_from_draft_id);
