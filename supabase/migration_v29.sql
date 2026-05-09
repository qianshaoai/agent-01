-- migration_v29
-- 版本：v29
-- 来自：5.9
-- 改了什么表：新增 workflow_sessions（工作流会话实例）
-- 是否需要数据迁移：否

CREATE TABLE IF NOT EXISTS workflow_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id      uuid        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name             text        NOT NULL DEFAULT '未命名会话',
  current_step_idx int         NOT NULL DEFAULT 0,
  status           text        NOT NULL DEFAULT 'in_progress',
    -- in_progress | completed | abandoned
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_sessions_user     ON workflow_sessions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_sessions_workflow ON workflow_sessions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_sessions_status  ON workflow_sessions (user_id, status);
