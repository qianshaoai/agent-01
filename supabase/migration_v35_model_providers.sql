-- 5.14up PR-A · 模型 API 统一管理
--
-- 把现有 "智能体自带 API key" 升级为 "平台统一管理模型供应商"，
-- 让管理员能集中管理各家大模型（OpenAI / 智谱 / 元器 / 清言 / Coze / Dify 等）
-- 的接入凭证、默认参数、启用状态，避免每个智能体重复填配置。
--
-- 后续 PR-B 的 agent_drafts 会通过 provider_id 引用本表，
-- PR-D 的 chat route 兼容时也按 agent.provider_id → providers.api_key_enc 优先级取 key。

CREATE TABLE IF NOT EXISTS model_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code   TEXT UNIQUE NOT NULL,        -- 业务编号 如 'openai-main' / 'zhipu-backup'
  name            TEXT NOT NULL,                -- 展示名 如 'OpenAI 主账号'
  platform        TEXT NOT NULL,                -- 适配器类型 'openai' | 'coze' | 'dify' | 'yuanqi' | 'qingyan' | 'zhipu'
  api_endpoint    TEXT NOT NULL DEFAULT '',    -- 接口地址 如 https://api.openai.com/v1/chat/completions
  api_key_enc     TEXT NOT NULL DEFAULT '',    -- 加密后的 API Key（lib/crypto.ts encrypt）
  default_model   TEXT NOT NULL DEFAULT '',    -- 默认模型 如 'gpt-4o-mini'
  default_params  JSONB NOT NULL DEFAULT '{}'::jsonb, -- 默认温度 / token / 厂商特殊参数
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID,                         -- admins.id 或 users.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 启用状态高频过滤
CREATE INDEX IF NOT EXISTS model_providers_enabled_idx
  ON model_providers(enabled);

-- platform 维度查询（"所有启用的 openai 兼容线路"）
CREATE INDEX IF NOT EXISTS model_providers_platform_idx
  ON model_providers(platform);

-- 关闭 RLS（与本项目其他后台表保持一致，由 service_role 在应用层鉴权）
ALTER TABLE model_providers DISABLE ROW LEVEL SECURITY;
