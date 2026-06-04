-- 6.4up · 自定义角色 + 模块化能力包 · Phase -1 · DB 基建
-- 来源：upgrade/6.4up/方案-权限管理-20260604.md（R1.2 拍板通过）
-- 改的表：
--   ① 新建 custom_roles            — 自定义角色定义
--   ② 新建 custom_role_permissions — 角色↔permission_key 多对多
--   ③ 新建 user_custom_roles       — users↔custom_roles 多对多
--   ④ ALTER workflows              — 加 created_by_kind / created_by_role_code，区分 builtin admin / custom admin 创建者
-- 数据迁移：workflows 历史行 → kind='admin', role_code=created_by_role（保持现有上下级判定不变）
--
-- 幂等：全部 CREATE/ALTER 用 IF NOT EXISTS；backfill 用 WHERE created_by_kind IS NULL 守卫
--
-- 设计要点（与 R1.2 方案对齐）：
--   · custom_roles.created_by / user_custom_roles.granted_by 不加 FK：admin actor 可能来自 admins 表或 users 表（5.11up + 5.16up 双来源现实），与 v28 drop audit_logs.admin_id FK 同理
--   · workflows.created_by_role 旧字段不动，旧 CHECK（v31）不动；custom admin 新建 workflow 时 created_by_role 留 NULL，只填 kind+role_code
--   · permission_key 不在 DB 加 CHECK；唯一来源是 lib/permission-keys.ts 常量 + API 入参校验（避免 enum 改一次要发一次 migration）

-- ── 1. 角色定义表 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID,                                  -- 无 FK · admins/users 双来源
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. 角色 ↔ 权限 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_role_permissions (
  role_id        UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON custom_role_permissions(role_id);

-- ── 3. 用户 ↔ 角色 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_custom_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  granted_by UUID,                                   -- 无 FK · admins/users 双来源
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_custom_roles_user ON user_custom_roles(user_id);

-- ── 4. workflows creator 语义拆分 ─────────────────────────────
-- 旧 created_by_role 留兼容（builtin admin 继续写）
-- 新字段：kind 区分 builtin / custom；role_code 在 custom admin 路径上存 custom_roles.code
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS created_by_kind TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role_code TEXT;

ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS chk_workflows_created_by_kind;
ALTER TABLE workflows
  ADD CONSTRAINT chk_workflows_created_by_kind
  CHECK (created_by_kind IS NULL OR created_by_kind IN ('admin', 'custom_admin'));

-- 历史回填：所有现存行视为 builtin admin 创建
UPDATE workflows
   SET created_by_kind      = 'admin',
       created_by_role_code = created_by_role
 WHERE created_by_kind IS NULL;

NOTIFY pgrst, 'reload schema';
