-- 5.30up · 组织级 ownership 基建（model_providers + knowledge_bases）
-- 来源：upgrade/5.30up/方案-org_admin-API+KB管理权限-20260529.md（R2 通过）
-- 改的表：model_providers + knowledge_bases 各加 tenant_code TEXT NULL + 单列 BTREE 索引
-- 数据迁移：无（存量行 tenant_code 默认 NULL = "平台公共"，与新口径一致）
--
-- 语义：
--   tenant_code IS NULL → 平台公共（super/system 建的）。全员可见；仅 super/system 可写
--   tenant_code = 'ORG-XYZ' → 组织建的。super/system + 该 org admin 可见；super/system + 该 org_admin 可写
--
-- 不加 FK 到 tenants(code)：与项目惯例一致（admins/users 也未加 FK），软引用 + 应用层校验
-- RLS：与现有 model_providers / knowledge_bases 一致，仍 DISABLE，服务端 service_role 鉴权
-- 索引选择：仅单列 BTREE（org_admin 列表过滤高频）；不加 (tenant_code, enabled) 复合
--           原因 —— enabled 已有独立索引，组合查询走两索引交即可
--
-- 幂等：IF NOT EXISTS 全部 → 可重跑

ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS tenant_code TEXT NULL;

ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS tenant_code TEXT NULL;

CREATE INDEX IF NOT EXISTS model_providers_tenant_code_idx
  ON model_providers(tenant_code);

CREATE INDEX IF NOT EXISTS knowledge_bases_tenant_code_idx
  ON knowledge_bases(tenant_code);

-- 让 PostgREST 立刻识别新列（避免应用层冷启动取不到 tenant_code 字段）
NOTIFY pgrst, 'reload schema';
