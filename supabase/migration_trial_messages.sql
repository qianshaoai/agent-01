-- Phase 1 / 4.30up：体验版本地消息存储
--
-- 目的：
--   把每条消息（user + assistant）存到我们自己的 DB，
--   让多轮上下文 + 历史回放对所有平台（不止 Coze）都能工作
--
-- 设计：
--   - chat_id 关联 trial_conversations，删除会话时级联删除消息
--   - role 只允许 user / assistant
--   - attachments 用 JSONB 存附件数组（[{file_id, kind, file_name?, previewUrl?}]）
--   - 按 created_at 排序拉取，简单直接

BEGIN;

CREATE TABLE IF NOT EXISTS trial_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id     UUID NOT NULL REFERENCES trial_conversations(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL DEFAULT '',
  attachments JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trial_messages_chat_idx
  ON trial_messages (chat_id, created_at);

COMMIT;

-- 验证：
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='trial_messages';
