-- migration_v22 · 4.30up
-- 给 messages 表加 aborted 列：标记被用户主动中断的 turn。
-- chat 路由拉历史时过滤 aborted=true 的消息，让被中断的对话仍可见但不进入 bot 上下文。
-- 默认 false，不影响历史数据。

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS aborted BOOLEAN NOT NULL DEFAULT FALSE;

-- 加联合索引，加速"成对配对 + aborted 过滤"两步查询
CREATE INDEX IF NOT EXISTS idx_messages_conv_active
  ON messages (conversation_id, created_at)
  WHERE aborted = FALSE;
