import pg from 'pg'
const { Client } = pg

// Supabase transaction pooler — uses API key as password
const client = new Client({
  host: 'db.jaqkrdpnslfktqdldmyi.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImphcWtyZHBuc2xma3RxZGxkbXlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3NzgyNywiZXhwIjoyMDkxMjUzODI3fQ.IZX3HZ0l2WipdATy9ZYLKaiF0jROM-tMnrAJoQ08Dz8',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

try {
  await client.connect()
  console.log('✓ 数据库连接成功')
} catch (e) {
  console.log('✗ 连接失败:', e.message)
  process.exit(1)
}

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pwd_hash TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 500,
  quota_used INTEGER NOT NULL DEFAULT 0,
  expires_at DATE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  tenant_code TEXT NOT NULL DEFAULT 'PERSONAL',
  pwd_hash TEXT NOT NULL,
  first_login BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone, tenant_code)
);

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  pwd_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  api_endpoint TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  model_params JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_agents (
  tenant_code TEXT NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_code, agent_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  platform_conv_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_code TEXT,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone TEXT,
  tenant_code TEXT,
  agent_code TEXT,
  agent_name TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  duration_ms INTEGER,
  error_msg TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS logs_created_idx ON logs (created_at DESC);
CREATE INDEX IF NOT EXISTS logs_tenant_idx ON logs (tenant_code, created_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  extracted_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO admins (username, pwd_hash)
VALUES ('admin', '$2b$10$QeyfJGSEt9nzm4Na13uNqeg1T7lCNRASH46eQSw87iNF/YJCftf62')
ON CONFLICT (username) DO NOTHING;

INSERT INTO categories (name, sort_order) VALUES
  ('文案写作', 1), ('数据分析', 2), ('客户服务', 3), ('知识问答', 4)
ON CONFLICT DO NOTHING;

INSERT INTO tenants (code, name, pwd_hash, quota, expires_at)
VALUES ('DEMO', '前哨科技测试企业', '$2b$10$S2IfRCl77PbEDOZgx60.1OhE9tADVklxnTlU3G7RGGGYE0Se0JWEC', 500, '2026-12-31')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE notices DISABLE ROW LEVEL SECURITY;
ALTER TABLE logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE files DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_quota_used(p_code TEXT)
RETURNS void AS $$
BEGIN
  UPDATE tenants SET quota_used = quota_used + 1
  WHERE code = p_code AND quota_used < quota;
END;
$$ LANGUAGE plpgsql;
`

try {
  await client.query(sql)
  console.log('✓ 所有表创建成功，初始数据已插入')
  console.log('\n可以登录了：')
  console.log('  管理员后台: http://localhost:3001/admin  账号: admin  密码: admin')
  console.log('  普通用户:   http://localhost:3001/login  企业码: DEMO  密码: demo123')
} catch (e) {
  console.log('✗ 执行失败:', e.message)
} finally {
  await client.end()
}
