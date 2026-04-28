-- 4.28up 体验版模块 · trial_conversations 表
--
-- 目的：
--   把每个 (体验账号, 体验智能体) 与 Coze 那边的 conversation_id 绑定，
--   让上下文 + 聊天记录跨浏览器、跨登录持续存在。
--
-- 设计：
--   - 不存消息内容；消息存在 Coze 那边，按需通过 /v1/conversation/message/list 拉
--   - (user_id, agent_id) 唯一，每个体验智能体每个用户独占一个 Coze 会话
--   - last_active_at 用于将来排序"最近聊过的智能体"

BEGIN;

CREATE TABLE IF NOT EXISTS trial_conversations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id             TEXT NOT NULL,             -- 对应 lib/trial-agents.ts 的 agent.id（如 agent_001）
  coze_conversation_id TEXT NOT NULL,             -- Coze 那边返回的 conversation_id
  last_active_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS trial_conversations_user_id_idx
  ON trial_conversations (user_id);

CREATE INDEX IF NOT EXISTS trial_conversations_last_active_idx
  ON trial_conversations (user_id, last_active_at DESC);

COMMIT;

-- 验证：
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='trial_conversations';
