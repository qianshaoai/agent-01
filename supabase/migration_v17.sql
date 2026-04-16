-- migration_v17: tenant_agents.tenant_code 添加外键约束
-- 先清理孤儿数据（引用了不存在租户的行）
DELETE FROM tenant_agents
WHERE tenant_code NOT IN (SELECT code FROM tenants);

-- 添加外键
ALTER TABLE tenant_agents
  ADD CONSTRAINT tenant_agents_tenant_code_fkey
  FOREIGN KEY (tenant_code) REFERENCES tenants(code) ON DELETE CASCADE;
