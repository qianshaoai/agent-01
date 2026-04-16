-- ============================================================
-- 智能体统一门户 — 数据库 Schema
-- 在 Supabase Dashboard > SQL Editor 中执行此文件
-- ============================================================

-- ── 启用 UUID 扩展 ──────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 企业码表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,          -- 统一大写存储
  name         TEXT NOT NULL,
  pwd_hash     TEXT NOT NULL,                 -- bcrypt 加密的企业初始密码
  quota        INTEGER NOT NULL DEFAULT 500,  -- 总次数
  quota_used   INTEGER NOT NULL DEFAULT 0,    -- 已用次数
  expires_at   DATE NOT NULL,                 -- 到期日
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 用户表 ───────────────────────────────────────────────────
-- 账号 = 手机号 + 企业码（个人用户 tenant_code = 'PERSONAL'）
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,
  tenant_code  TEXT NOT NULL DEFAULT 'PERSONAL',
  pwd_hash     TEXT NOT NULL,
  first_login  BOOLEAN NOT NULL DEFAULT TRUE,  -- 是否未改过密码
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone, tenant_code)
);

-- ── 管理员表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username   TEXT UNIQUE NOT NULL,
  pwd_hash   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 分类表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 智能体表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code   TEXT UNIQUE NOT NULL,   -- 业务编号，如 AGT-001
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  platform     TEXT NOT NULL,           -- coze | dify | zhipu | other
  api_endpoint TEXT NOT NULL DEFAULT '',
  api_key_enc  TEXT NOT NULL DEFAULT '', -- 加密存储
  model_params JSONB NOT NULL DEFAULT '{}',
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 企业↔智能体分配 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_agents (
  tenant_code TEXT NOT NULL REFERENCES tenants(code) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_code, agent_id)
);

-- ── 会话表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '新对话',
  platform_conv_id TEXT,                               -- 平台侧会话ID（如清言 conversation_id）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 消息表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at);

-- ── 公告表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT,        -- NULL = 全局公告；否则为企业码
  content     TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 日志表 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone  TEXT,
  tenant_code TEXT,
  agent_code  TEXT,
  agent_name  TEXT,
  action      TEXT NOT NULL,   -- login | chat | upload | speech
  status      TEXT NOT NULL CHECK (status IN ('success', 'error')),
  duration_ms INTEGER,
  error_msg   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS logs_created_idx    ON logs (created_at DESC);
CREATE INDEX IF NOT EXISTS logs_tenant_idx     ON logs (tenant_code, created_at DESC);
CREATE INDEX IF NOT EXISTS logs_agent_code_idx ON logs (agent_code);
CREATE INDEX IF NOT EXISTS logs_user_phone_idx ON logs (user_phone);
CREATE INDEX IF NOT EXISTS logs_action_idx     ON logs (action);

-- ── 上传文件表 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  filename        TEXT NOT NULL,
  file_type       TEXT NOT NULL,
  extracted_text  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 初始化数据
-- ============================================================

-- ── 默认管理员：admin / admin ────────────────────────────────
-- bcrypt("admin", 10) 生成的真实 hash
INSERT INTO admins (username, pwd_hash)
VALUES ('admin', '$2b$10$QeyfJGSEt9nzm4Na13uNqeg1T7lCNRASH46eQSw87iNF/YJCftf62')
ON CONFLICT (username) DO NOTHING;

-- ── 默认分类 ─────────────────────────────────────────────────
INSERT INTO categories (name, sort_order) VALUES
  ('文案写作', 1),
  ('数据分析', 2),
  ('客户服务', 3),
  ('知识问答', 4)
ON CONFLICT DO NOTHING;

-- ── 测试企业（企业码 DEMO / 初始密码 demo123）────────────────
-- bcrypt("demo123", 10)
INSERT INTO tenants (code, name, pwd_hash, quota, expires_at)
VALUES ('DEMO', '前哨科技测试企业', '$2b$10$S2IfRCl77PbEDOZgx60.1OhE9tADVklxnTlU3G7RGGGYE0Se0JWEC', 500, '2026-12-31')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- RLS (Row Level Security) — Supabase 推荐开启
-- 由于我们用 service_role key 在服务端操作，可暂时关闭 RLS
-- ============================================================
ALTER TABLE tenants       DISABLE ROW LEVEL SECURITY;
ALTER TABLE users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins        DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories    DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents        DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages      DISABLE ROW LEVEL SECURITY;
ALTER TABLE notices       DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs          DISABLE ROW LEVEL SECURITY;
ALTER TABLE files         DISABLE ROW LEVEL SECURITY;
