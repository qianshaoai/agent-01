-- migration_v18: logs 表添加高频查询字段索引
CREATE INDEX IF NOT EXISTS logs_agent_code_idx ON logs (agent_code);
CREATE INDEX IF NOT EXISTS logs_user_phone_idx ON logs (user_phone);
CREATE INDEX IF NOT EXISTS logs_action_idx     ON logs (action);
