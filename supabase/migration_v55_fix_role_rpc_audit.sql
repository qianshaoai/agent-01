-- v55 · 6.6up · 修复角色晋升 RPC 审计必填字段
-- 表：audit_logs / users / admins / user_custom_roles
-- 目的：修复 change_user_role_clear_custom 写 audit_logs 时缺 admin_username 导致 400 "缺少必填字段"
-- 数据迁移：无，仅 CREATE OR REPLACE FUNCTION 覆盖函数定义

CREATE OR REPLACE FUNCTION change_user_role_clear_custom(
  p_user_id  UUID,
  p_new_role TEXT,
  p_actor_id UUID
) RETURNS VOID AS $$
DECLARE
  v_old_role TEXT;
  v_target_tenant_code TEXT;
  v_actor_username TEXT;
  v_actor_role TEXT;
  v_actor_tenant_code TEXT;
BEGIN
  SELECT role, tenant_code
    INTO v_old_role, v_target_tenant_code
    FROM users
    WHERE id = p_user_id;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- actor 可能来自 admins 表，也可能来自 users 表（user_admin 路径）。
  SELECT
    username,
    COALESCE(role, 'super_admin'),
    tenant_code
    INTO v_actor_username, v_actor_role, v_actor_tenant_code
    FROM admins
    WHERE id = p_actor_id;

  IF v_actor_username IS NULL THEN
    SELECT
      COALESCE(username, phone, id::TEXT),
      COALESCE(role, 'user'),
      tenant_code
      INTO v_actor_username, v_actor_role, v_actor_tenant_code
      FROM users
      WHERE id = p_actor_id;
  END IF;

  v_actor_username := COALESCE(v_actor_username, p_actor_id::TEXT);
  v_actor_role := COALESCE(v_actor_role, 'unknown');

  UPDATE users SET role = p_new_role WHERE id = p_user_id;

  -- 仅当新角色是 builtin admin 时清 user_custom_roles，避免 builtin + custom 双通道叠权。
  IF p_new_role IN ('super_admin', 'system_admin', 'org_admin') THEN
    DELETE FROM user_custom_roles WHERE user_id = p_user_id;

    INSERT INTO audit_logs(
      admin_id,
      admin_username,
      admin_role,
      admin_tenant_code,
      action,
      resource_type,
      resource_id,
      resource_tenant_code,
      detail
    ) VALUES (
      p_actor_id,
      v_actor_username,
      v_actor_role,
      v_actor_tenant_code,
      'delete',
      'custom_role',
      p_user_id::TEXT,
      v_target_tenant_code,
      jsonb_build_object(
        'reason', 'promoted_to_builtin_admin',
        'old_role', v_old_role,
        'new_role', p_new_role
      )
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
