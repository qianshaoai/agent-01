-- Migration v6: add platform_conv_id to user_agents for qingyan context tracking
ALTER TABLE user_agents ADD COLUMN IF NOT EXISTS platform_conv_id TEXT NOT NULL DEFAULT '';
