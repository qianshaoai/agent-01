-- migration_v30
-- 版本：v30
-- 来自：5.9
-- 改了什么表：conversations — 新增 session_id 列，关联工作流会话
-- 是否需要数据迁移：否（历史对话 session_id = NULL，视为普通聊天，行为不变）

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES workflow_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations (session_id);
