-- migration_v24 · 5.6up
-- 后台修改用户所属组织
--
-- 1) users 加 force_relogin_at 列：强制重登机制
--    middleware / lib/auth 验 token 时若 token.iat < users.force_relogin_at 视为失效
-- 2) RPC change_user_tenant：单事务做完所有变更
--
-- 详见：upgrade/5.6up/用户改组织-方案-20260506.md

-- ── 1. 加列（幂等）─────────────────────────────────────────
-- users 和 admins 都要：被转组织的 user 强制重登；如该 user 同时是 admin 角色，
-- admins 侧的登录态也要踢掉（虽然本次 RPC 只动 users 的 force_relogin_at，
-- admins 列保留以备将来"管理员被降级"等场景使用 + middleware 查询不报错）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS force_relogin_at TIMESTAMPTZ;
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS force_relogin_at TIMESTAMPTZ;

-- ── 2. RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION change_user_tenant(
  p_user_id UUID,
  p_new_tenant_code TEXT
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_tenant_code TEXT;
  v_user_phone      TEXT;
  v_old_role        TEXT;
  v_new_user_type   TEXT;
  v_new_role        TEXT;
BEGIN
  -- 校验目标组织存在或为 PERSONAL
  IF p_new_tenant_code <> 'PERSONAL'
     AND NOT EXISTS (SELECT 1 FROM tenants WHERE code = p_new_tenant_code) THEN
    RAISE EXCEPTION 'tenant_code "%" not found', p_new_tenant_code;
  END IF;

  -- 取旧值
  SELECT tenant_code, phone, role
  INTO   v_old_tenant_code, v_user_phone, v_old_role
  FROM   users
  WHERE  id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user_id;
  END IF;
  IF v_old_tenant_code = p_new_tenant_code THEN
    RAISE EXCEPTION 'user % already in tenant %', p_user_id, p_new_tenant_code;
  END IF;

  -- 唯一约束前置校验：UNIQUE(phone, tenant_code)
  IF EXISTS (
    SELECT 1 FROM users
    WHERE  phone       = v_user_phone
      AND  tenant_code = p_new_tenant_code
      AND  id          <> p_user_id
  ) THEN
    RAISE EXCEPTION 'tenant "%" already has a user with phone %', p_new_tenant_code, v_user_phone;
  END IF;

  -- 派生新值
  v_new_user_type := CASE WHEN p_new_tenant_code = 'PERSONAL' THEN 'personal' ELSE 'organization' END;
  -- 角色规则：org_admin 跨组织一律降为 user；其它角色保持
  v_new_role := CASE WHEN v_old_role = 'org_admin' THEN 'user' ELSE v_old_role END;

  -- 1) 改 users（同步 tenant_code / user_type / role / 清 dept_id+team_id / 强制重登）
  UPDATE users
     SET tenant_code      = p_new_tenant_code,
         user_type        = v_new_user_type,
         role             = v_new_role,
         dept_id          = NULL,
         team_id          = NULL,
         force_relogin_at = NOW()
   WHERE id = p_user_id;

  -- 2) 清理跨组织分组成员关系
  --    保留：tenant_code IS NULL 的全平台分组
  --    保留：tenant_code = 新组织 的分组（理论上一般没有，留兜底）
  --    删除：其它任何"非新组织 + 非全平台"的分组成员关系
  DELETE FROM user_group_members
   WHERE user_id = p_user_id
     AND group_id IN (
       SELECT id FROM user_groups
       WHERE  tenant_code IS NOT NULL
         AND  tenant_code <> p_new_tenant_code
     );

  -- 3) 追溯改 logs（决策 ii）— 按 user_phone + 旧 tenant_code
  UPDATE logs
     SET tenant_code = p_new_tenant_code
   WHERE user_phone  = v_user_phone
     AND tenant_code = v_old_tenant_code;

  -- 4) 审计事件
  INSERT INTO logs (user_phone, tenant_code, action, status, error_msg)
  VALUES (
    v_user_phone,
    p_new_tenant_code,
    'admin_change_user_tenant',
    'success',
    'from ' || v_old_tenant_code || ' to ' || p_new_tenant_code
      || CASE WHEN v_old_role = 'org_admin' THEN ' (role demoted: org_admin -> user)' ELSE '' END
  );
END;
$$;
