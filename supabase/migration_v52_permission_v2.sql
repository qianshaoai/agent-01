-- 6.4up Phase A · v52 · 权限管理 v2 基建
--
-- 配套文档：
--   - upgrade/6.4up/方案-权限管理v2-合并版-20260605.md
--   - upgrade/6.4up/矩阵-资源权限现状-20260605.md（seed 来源）
--
-- 与 v50 / v51 的关系：
--   - v50 (custom_roles 三张表) 保留，custom 通道完全独立
--   - v51 (workflows.created_by drop FK) 保留
--   - v52 加 builtin admin v2 通道两张表 + seed + 一个 RPC
--
-- 行为切换：
--   v52 表跑完后行为不变；代码侧由 PERMISSION_V2_ENFORCE_RESOURCES env CSV 控制
--   哪些 resource 走 v2 enforce；空 = 等价 6.4up 行为；回滚 = 清空 CSV
--
-- 回滚：DROP TABLE builtin_role_permissions, admin_permission_overrides;
--      DROP FUNCTION change_user_role_clear_custom; v50/v51 不动。

-- ────────────────────────────────────────────────────────────────
-- 1. 表 schema
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS builtin_role_permissions (
  role           TEXT NOT NULL CHECK (role IN ('system_admin', 'org_admin')),
  permission_key TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID,
  PRIMARY KEY (role, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_brp_role ON builtin_role_permissions(role);

CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  admin_id       UUID NOT NULL,
  admin_source   TEXT NOT NULL CHECK (admin_source IN ('admin_table', 'user_admin')),
  permission_key TEXT NOT NULL,
  effect         TEXT NOT NULL CHECK (effect IN ('grant', 'revoke')),
  reason         TEXT,
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_source, admin_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_apo_admin ON admin_permission_overrides(admin_source, admin_id);

-- ────────────────────────────────────────────────────────────────
-- 2. seed · system_admin 默认包（109 keys）
--    来源：upgrade/6.4up/矩阵-资源权限现状-20260605.md `proposed_role_seed` 列
--    口径：与现状代码完全等价；零默默放权
-- ────────────────────────────────────────────────────────────────

INSERT INTO builtin_role_permissions (role, permission_key) VALUES
  -- workflow（24 keys：read/create/update + enable/duplicate/delete × team/dept/org/all）
  ('system_admin', 'workflow.read.team'),
  ('system_admin', 'workflow.read.dept'),
  ('system_admin', 'workflow.read.org'),
  ('system_admin', 'workflow.read.all'),
  ('system_admin', 'workflow.create.team'),
  ('system_admin', 'workflow.create.dept'),
  ('system_admin', 'workflow.create.org'),
  ('system_admin', 'workflow.create.all'),
  ('system_admin', 'workflow.update.team'),
  ('system_admin', 'workflow.update.dept'),
  ('system_admin', 'workflow.update.org'),
  ('system_admin', 'workflow.update.all'),
  ('system_admin', 'workflow.enable.team'),
  ('system_admin', 'workflow.enable.dept'),
  ('system_admin', 'workflow.enable.org'),
  ('system_admin', 'workflow.enable.all'),
  ('system_admin', 'workflow.duplicate.team'),
  ('system_admin', 'workflow.duplicate.dept'),
  ('system_admin', 'workflow.duplicate.org'),
  ('system_admin', 'workflow.duplicate.all'),
  ('system_admin', 'workflow.delete.team'),
  ('system_admin', 'workflow.delete.dept'),
  ('system_admin', 'workflow.delete.org'),
  ('system_admin', 'workflow.delete.all'),
  -- agent（9 keys）
  ('system_admin', 'agent.read.org'),
  ('system_admin', 'agent.read.all'),
  ('system_admin', 'agent.basic.update.org'),
  ('system_admin', 'agent.basic.update.all'),
  ('system_admin', 'agent.reindex.all'),
  ('system_admin', 'agent.enable.org'),
  ('system_admin', 'agent.enable.all'),
  ('system_admin', 'agent.delete.org'),
  ('system_admin', 'agent.delete.all'),
  -- agent_draft（14 keys）
  ('system_admin', 'agent_draft.read.org'),
  ('system_admin', 'agent_draft.read.all'),
  ('system_admin', 'agent_draft.create.org'),
  ('system_admin', 'agent_draft.create.all'),
  ('system_admin', 'agent_draft.update.org'),
  ('system_admin', 'agent_draft.update.all'),
  ('system_admin', 'agent_draft.publish.org'),
  ('system_admin', 'agent_draft.publish.all'),
  ('system_admin', 'agent_draft.duplicate.org'),
  ('system_admin', 'agent_draft.duplicate.all'),
  ('system_admin', 'agent_draft.test.org'),
  ('system_admin', 'agent_draft.test.all'),
  ('system_admin', 'agent_draft.delete.org'),
  ('system_admin', 'agent_draft.delete.all'),
  -- kb（8 keys）
  ('system_admin', 'kb.read.org'),
  ('system_admin', 'kb.read.all'),
  ('system_admin', 'kb.create.org'),
  ('system_admin', 'kb.create.all'),
  ('system_admin', 'kb.update.org'),
  ('system_admin', 'kb.update.all'),
  ('system_admin', 'kb.delete.org'),
  ('system_admin', 'kb.delete.all'),
  -- provider（4 keys：仅 read + test；现状 system_admin 不能创建/修改/删除 provider）
  ('system_admin', 'provider.read.org'),
  ('system_admin', 'provider.read.all'),
  ('system_admin', 'provider.test.org'),
  ('system_admin', 'provider.test.all'),
  -- notice（8 keys）
  ('system_admin', 'notice.read.org'),
  ('system_admin', 'notice.read.all'),
  ('system_admin', 'notice.create.org'),
  ('system_admin', 'notice.create.all'),
  ('system_admin', 'notice.update.org'),
  ('system_admin', 'notice.update.all'),
  ('system_admin', 'notice.delete.org'),
  ('system_admin', 'notice.delete.all'),
  -- user（16 keys：read + 7 sub-actions × org/all；不含 create）
  ('system_admin', 'user.read.org'),
  ('system_admin', 'user.read.all'),
  ('system_admin', 'user.role.update.org'),
  ('system_admin', 'user.role.update.all'),
  ('system_admin', 'user.tenant.transfer.org'),
  ('system_admin', 'user.tenant.transfer.all'),
  ('system_admin', 'user.department.assign.org'),
  ('system_admin', 'user.department.assign.all'),
  ('system_admin', 'user.team.assign.org'),
  ('system_admin', 'user.team.assign.all'),
  ('system_admin', 'user.password.reset.org'),
  ('system_admin', 'user.password.reset.all'),
  ('system_admin', 'user.enable.org'),
  ('system_admin', 'user.enable.all'),
  ('system_admin', 'user.delete.org'),
  ('system_admin', 'user.delete.all'),
  -- tenant（4 keys，all only）
  ('system_admin', 'tenant.read.all'),
  ('system_admin', 'tenant.create.all'),
  ('system_admin', 'tenant.update.all'),
  ('system_admin', 'tenant.delete.all'),
  -- category（4 keys，all only）
  ('system_admin', 'category.read.all'),
  ('system_admin', 'category.create.all'),
  ('system_admin', 'category.update.all'),
  ('system_admin', 'category.delete.all'),
  -- dept（8 keys）
  ('system_admin', 'dept.read.org'),
  ('system_admin', 'dept.read.all'),
  ('system_admin', 'dept.create.org'),
  ('system_admin', 'dept.create.all'),
  ('system_admin', 'dept.update.org'),
  ('system_admin', 'dept.update.all'),
  ('system_admin', 'dept.delete.org'),
  ('system_admin', 'dept.delete.all'),
  -- team（8 keys）
  ('system_admin', 'team.read.org'),
  ('system_admin', 'team.read.all'),
  ('system_admin', 'team.create.org'),
  ('system_admin', 'team.create.all'),
  ('system_admin', 'team.update.org'),
  ('system_admin', 'team.update.all'),
  ('system_admin', 'team.delete.org'),
  ('system_admin', 'team.delete.all'),
  -- audit（2 keys）
  ('system_admin', 'audit.read.org'),
  ('system_admin', 'audit.read.all')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 3. seed · org_admin 默认包（64 keys）
-- ────────────────────────────────────────────────────────────────

INSERT INTO builtin_role_permissions (role, permission_key) VALUES
  -- workflow（18 keys：team/dept/org × read/create/update/enable/duplicate/delete；不含 .all）
  ('org_admin', 'workflow.read.team'),
  ('org_admin', 'workflow.read.dept'),
  ('org_admin', 'workflow.read.org'),
  ('org_admin', 'workflow.create.team'),
  ('org_admin', 'workflow.create.dept'),
  ('org_admin', 'workflow.create.org'),
  ('org_admin', 'workflow.update.team'),
  ('org_admin', 'workflow.update.dept'),
  ('org_admin', 'workflow.update.org'),
  ('org_admin', 'workflow.enable.team'),
  ('org_admin', 'workflow.enable.dept'),
  ('org_admin', 'workflow.enable.org'),
  ('org_admin', 'workflow.duplicate.team'),
  ('org_admin', 'workflow.duplicate.dept'),
  ('org_admin', 'workflow.duplicate.org'),
  ('org_admin', 'workflow.delete.team'),
  ('org_admin', 'workflow.delete.dept'),
  ('org_admin', 'workflow.delete.org'),
  -- agent（4 keys，仅 org）
  ('org_admin', 'agent.read.org'),
  ('org_admin', 'agent.basic.update.org'),
  ('org_admin', 'agent.enable.org'),
  ('org_admin', 'agent.delete.org'),
  -- agent_draft（7 keys）
  ('org_admin', 'agent_draft.read.org'),
  ('org_admin', 'agent_draft.create.org'),
  ('org_admin', 'agent_draft.update.org'),
  ('org_admin', 'agent_draft.publish.org'),
  ('org_admin', 'agent_draft.duplicate.org'),
  ('org_admin', 'agent_draft.test.org'),
  ('org_admin', 'agent_draft.delete.org'),
  -- kb（4 keys）
  ('org_admin', 'kb.read.org'),
  ('org_admin', 'kb.create.org'),
  ('org_admin', 'kb.update.org'),
  ('org_admin', 'kb.delete.org'),
  -- provider（5 keys：read + test + create/update/delete；org_admin 可全权管理本组织 provider）
  ('org_admin', 'provider.read.org'),
  ('org_admin', 'provider.create.org'),
  ('org_admin', 'provider.update.org'),
  ('org_admin', 'provider.delete.org'),
  ('org_admin', 'provider.test.org'),
  -- notice（4 keys）
  ('org_admin', 'notice.read.org'),
  ('org_admin', 'notice.create.org'),
  ('org_admin', 'notice.update.org'),
  ('org_admin', 'notice.delete.org'),
  -- user（8 keys：read + 7 sub-actions × org；不含 create）
  ('org_admin', 'user.read.org'),
  ('org_admin', 'user.role.update.org'),
  ('org_admin', 'user.tenant.transfer.org'),
  ('org_admin', 'user.department.assign.org'),
  ('org_admin', 'user.team.assign.org'),
  ('org_admin', 'user.password.reset.org'),
  ('org_admin', 'user.enable.org'),
  ('org_admin', 'user.delete.org'),
  -- tenant（1 key：仅 read.all 出自家）
  ('org_admin', 'tenant.read.all'),
  -- category（4 keys，all only —— 与现状一致：org_admin 也能管全平台分类）
  ('org_admin', 'category.read.all'),
  ('org_admin', 'category.create.all'),
  ('org_admin', 'category.update.all'),
  ('org_admin', 'category.delete.all'),
  -- dept（4 keys，仅 org）
  ('org_admin', 'dept.read.org'),
  ('org_admin', 'dept.create.org'),
  ('org_admin', 'dept.update.org'),
  ('org_admin', 'dept.delete.org'),
  -- team（4 keys，仅 org）
  ('org_admin', 'team.read.org'),
  ('org_admin', 'team.create.org'),
  ('org_admin', 'team.update.org'),
  ('org_admin', 'team.delete.org'),
  -- audit（1 key）
  ('org_admin', 'audit.read.org')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- 4. RPC · change_user_role_clear_custom
--    用途：app/api/admin/users/[id]/route.ts set-role 分支调用
--    语义：role 从 'user' 变为 builtin admin 时，一次事务完成：
--           UPDATE users.role + DELETE user_custom_roles + INSERT audit_logs
--    防御：若 new_role 不在 admin role 集，仅 UPDATE role 不清 custom（兼容降级）
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION change_user_role_clear_custom(
  p_user_id  UUID,
  p_new_role TEXT,
  p_actor_id UUID
) RETURNS VOID AS $$
DECLARE
  v_old_role TEXT;
BEGIN
  SELECT role INTO v_old_role FROM users WHERE id = p_user_id;
  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  UPDATE users SET role = p_new_role WHERE id = p_user_id;

  -- 仅当新角色是 builtin admin 时清 user_custom_roles
  IF p_new_role IN ('super_admin', 'system_admin', 'org_admin') THEN
    DELETE FROM user_custom_roles WHERE user_id = p_user_id;

    -- 写一条 audit（resource_type='custom_role'，detail 含原因）
    INSERT INTO audit_logs(
      admin_id, admin_role, action, resource_type, resource_id, detail
    ) VALUES (
      p_actor_id,
      'super_admin',
      'delete',
      'custom_role',
      p_user_id,
      jsonb_build_object(
        'reason', 'promoted_to_builtin_admin',
        'old_role', v_old_role,
        'new_role', p_new_role
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────
-- 5. 通知 PostgREST 刷 schema
-- ────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
