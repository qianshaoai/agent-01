-- 4.28up 体验版模块 · trial_conversations 多会话改造（v2）
--
-- 变化：
--   1) 去掉 (user_id, agent_id) 唯一约束 —— 允许同一智能体下多条聊天记录
--   2) coze_conversation_id 允许 NULL —— 新建聊天到首次发送之间会有空窗
--   3) 新增 title 列 —— 列表展示标题（首条用户消息前 30 字自动生成）
--   4) TRUNCATE 现有数据（按用户要求清空旧记录）

BEGIN;

ALTER TABLE trial_conversations
  DROP CONSTRAINT IF EXISTS trial_conversations_user_id_agent_id_key;

ALTER TABLE trial_conversations
  ALTER COLUMN coze_conversation_id DROP NOT NULL;

ALTER TABLE trial_conversations
  ADD COLUMN IF NOT EXISTS title TEXT;

-- 清空旧数据
TRUNCATE TABLE trial_conversations;

COMMIT;
