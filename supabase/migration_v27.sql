-- migration_v27
-- 版本：v27
-- 来自：5.8up
-- 改了什么表：新增 audit_logs（管理员变更审计记录）
-- 是否需要数据迁移：否

CREATE TABLE IF NOT EXISTS audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      uuid        REFERENCES admins(id) ON DELETE SET NULL,
  admin_username text       NOT NULL,
  admin_role    text        NOT NULL,
  action        text        NOT NULL,   -- create | update | delete | enable | disable
  resource_type text        NOT NULL,   -- agent | workflow
  resource_id   text,
  resource_name text,
  detail        jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at    ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs (resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id      ON audit_logs (admin_id);
