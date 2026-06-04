/**
 * 6.4up · 权限管理 · PermissionActor 与判定 helper
 *
 * 与已有 lib/permissions.ts 区分：
 *   - lib/permissions.ts → 用户端 resource visibility（getVisibleResourcesForUser）
 *   - lib/permission-actor.ts（本文件）→ 后台 actor 上下文 + hasPermission 业务判定
 *
 * 设计（方案 R1.2 § AccessPayload + PermissionActor / hasPermission）：
 *
 *   1. buildPermissionActor(accessPayload) — 从 access cookie 派生出含 scope 上下文的 actor
 *      - builtin admin：tenantCode / dept_id / team_id 从 admins 或 users 表查
 *      - custom admin：tenantCode / dept_id / team_id / userType 从 users 表查；
 *                      customRoleCodes / permissions 从 user_custom_roles + custom_role_permissions 表查
 *
 *   2. hasAnyCustomRole(userId) — 给 admin/login / elevate-to-admin / /api/me
 *      "是否可签 custom access cookie" 用，单表 EXISTS 查询
 *
 *   3. hasPermission(actor, key, targetScopes?) — 业务判定核心
 *      - builtin admin 走旧 role 规则（super_admin 放行；system_admin workflow 放行；org_admin 按 tenantCode 闸门）
 *      - custom admin 走 permission keys + scope 包含关系
 *
 *   4. listReadableScopes(actor) — list 路径筛选辅助
 */

import { db } from "@/lib/db";
import {
  AdminAccessPayload,
  AdminPayload,
  AdminRole,
  CustomAdminPayload,
  isCustomAdminPayload,
} from "@/lib/auth";
import {
  PermissionKey,
  PERMISSION_KEYS,
  getPermissionScopeSuffix,
  getPermissionResource,
  isPermissionKey,
  PermissionScopeSuffix,
} from "@/lib/permission-keys";

// ─── 类型 ────────────────────────────────────────────────────

export type PermissionActor = {
  /** builtin: adminId; custom: userId（与 access payload 对应） */
  actorId: string;
  source: "admin_table" | "user_admin" | "custom_admin";
  /** org_admin / user_admin / custom_admin 都可能有；admin_table 无组织归属可能为 null */
  tenantCode: string | null;
  /** custom admin / user_admin 才有；builtin admin_table 永远 null */
  deptId: string | null;
  teamId: string | null;
  userType: "personal" | "organization" | null;
  /** builtin admin 才有 role；custom admin 为 null */
  builtinRole: AdminRole | null;
  /** custom admin 持有的 custom_roles.code 列表 */
  customRoleCodes: string[];
  /** custom admin 派生出的完整 permission_key 集（dedup 后） */
  permissions: Set<PermissionKey>;
  /** 用户名（供审计日志用，buildPermissionActor 顺手取出） */
  username: string;
};

export type ResourceScope = {
  scope_type: "all" | "org" | "dept" | "team";
  scope_id: string | null;
};

// ─── 1. buildPermissionActor ─────────────────────────────────

export async function buildPermissionActor(
  payload: AdminAccessPayload
): Promise<PermissionActor> {
  if (isCustomAdminPayload(payload)) {
    return buildCustomAdminActor(payload);
  }
  return buildBuiltinAdminActor(payload as AdminPayload);
}

async function buildBuiltinAdminActor(p: AdminPayload): Promise<PermissionActor> {
  // 先查 admins 表（admin_table 路径）
  const { data: adminRow } = await db
    .from("admins")
    .select("id, username, tenant_code, role")
    .eq("id", p.adminId)
    .maybeSingle();
  if (adminRow) {
    return {
      actorId: p.adminId,
      source: "admin_table",
      tenantCode: adminRow.tenant_code ?? p.tenantCode ?? null,
      deptId: null,
      teamId: null,
      userType: null,
      builtinRole: (adminRow.role as AdminRole | null) ?? p.role,
      customRoleCodes: [],
      permissions: new Set<PermissionKey>(),
      username: adminRow.username ?? p.username,
    };
  }
  // 再查 users 表（user_admin 路径，5.11up 起 users.role 提升模式）
  const { data: userRow } = await db
    .from("users")
    .select("id, username, phone, tenant_code, dept_id, team_id, user_type, role")
    .eq("id", p.adminId)
    .maybeSingle();
  if (userRow) {
    return {
      actorId: p.adminId,
      source: "user_admin",
      tenantCode: userRow.tenant_code ?? p.tenantCode ?? null,
      deptId: userRow.dept_id ?? null,
      teamId: userRow.team_id ?? null,
      userType: (userRow.user_type as "personal" | "organization" | null) ?? null,
      builtinRole: (userRow.role as AdminRole | null) ?? p.role,
      customRoleCodes: [],
      permissions: new Set<PermissionKey>(),
      username: userRow.username ?? userRow.phone ?? p.username,
    };
  }
  // 双源都查不到 → fallback 到 JWT payload（与 getActiveAdmin 一致的容错策略）
  return {
    actorId: p.adminId,
    source: "admin_table",
    tenantCode: p.tenantCode ?? null,
    deptId: null,
    teamId: null,
    userType: null,
    builtinRole: p.role,
    customRoleCodes: [],
    permissions: new Set<PermissionKey>(),
    username: p.username,
  };
}

async function buildCustomAdminActor(p: CustomAdminPayload): Promise<PermissionActor> {
  const [{ data: userRow }, { data: roleRows }] = await Promise.all([
    db
      .from("users")
      .select("id, username, phone, tenant_code, dept_id, team_id, user_type, status")
      .eq("id", p.userId)
      .maybeSingle(),
    db
      .from("user_custom_roles")
      .select("role_id, custom_roles!inner(code, enabled)")
      .eq("user_id", p.userId),
  ]);

  type RoleJoinRow = {
    role_id: string;
    custom_roles: { code: string; enabled: boolean } | { code: string; enabled: boolean }[] | null;
  };
  const enabledRoleIds: string[] = [];
  const customRoleCodes: string[] = [];
  for (const r of (roleRows ?? []) as RoleJoinRow[]) {
    const j = r.custom_roles;
    const role = Array.isArray(j) ? j[0] : j;
    if (role && role.enabled) {
      enabledRoleIds.push(r.role_id);
      customRoleCodes.push(role.code);
    }
  }

  // 查 permission_keys（仅 enabled 角色的）
  const permissions = new Set<PermissionKey>();
  if (enabledRoleIds.length > 0) {
    const { data: permRows } = await db
      .from("custom_role_permissions")
      .select("permission_key")
      .in("role_id", enabledRoleIds);
    for (const row of (permRows ?? []) as { permission_key: string }[]) {
      if (isPermissionKey(row.permission_key)) permissions.add(row.permission_key);
    }
  }

  return {
    actorId: p.userId,
    source: "custom_admin",
    tenantCode: userRow?.tenant_code ?? null,
    deptId: userRow?.dept_id ?? null,
    teamId: userRow?.team_id ?? null,
    userType: (userRow?.user_type as "personal" | "organization" | null) ?? null,
    builtinRole: null,
    customRoleCodes,
    permissions,
    username: userRow?.username ?? userRow?.phone ?? p.username,
  };
}

// ─── 2. hasAnyCustomRole ─────────────────────────────────────

/**
 * 用户是否持有任一启用中的 custom role
 *
 * 给 admin/login 第 2 路径（users 表）、elevate-to-admin、/api/me 用 ——
 * 决定是否能给该用户签 custom admin cookie / 在 /api/me 报 isAdmin=true。
 */
export async function hasAnyCustomRole(userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("user_custom_roles")
    .select("role_id, custom_roles!inner(enabled)")
    .eq("user_id", userId)
    .limit(50);
  if (error || !data) return false;
  type Row = { custom_roles: { enabled: boolean } | { enabled: boolean }[] | null };
  for (const row of data as Row[]) {
    const j = row.custom_roles;
    const role = Array.isArray(j) ? j[0] : j;
    if (role?.enabled) return true;
  }
  return false;
}

// ─── 3. hasPermission ────────────────────────────────────────

/**
 * 业务判定：actor 是否有权对 key 描述的能力执行操作
 *
 * targetScopes 语义：
 *   - read：通常不传（list 路径），由调用方根据 actor 权限筛选 workflow 集
 *   - create：传 [想要新建 workflow 命中的 scope]，校验是否能写
 *   - update/delete：传 [目标 workflow 现有的所有 scope]，必须全部落在 actor 权限范围内
 *
 * builtin admin 走 role-based fallback（保 5.11up 上下级语义）：
 *   - super_admin：放行
 *   - system_admin：workflow.* 全放行
 *   - org_admin：workflow.* 在本组织范围内放行
 *
 * custom admin 走 permission keys + scope 包含关系。
 */
export async function hasPermission(
  actor: PermissionActor,
  key: PermissionKey,
  targetScopes?: ResourceScope[]
): Promise<boolean> {
  // builtin admin 不走 permission keys，复用旧 role 规则
  if (actor.source !== "custom_admin") {
    const role = actor.builtinRole;
    if (!role) return false;
    if (role === "super_admin") return true;
    const resource = getPermissionResource(key);
    if (role === "system_admin" && resource === "workflow") return true;
    if (role === "org_admin" && resource === "workflow") {
      // org_admin 必须有 tenantCode，且 targetScopes（若传）全部命中本组织
      if (!actor.tenantCode) return false;
      if (!targetScopes || targetScopes.length === 0) return true;
      for (const s of targetScopes) {
        const inOrg = await isScopeWithinOrg(s, actor.tenantCode);
        if (!inOrg) return false;
      }
      return true;
    }
    return false;
  }

  // custom admin 路径
  if (!actor.permissions.has(key)) return false;
  const suffix = getPermissionScopeSuffix(key);
  if (!targetScopes || targetScopes.length === 0) {
    // read/create 无明确目标时（list 路径 / 调用方稍后再做 scope 路由）→ 持 key 即放行
    return true;
  }
  for (const s of targetScopes) {
    const ok = await isScopeWithinActorRange(actor, suffix, s);
    if (!ok) return false;
  }
  return true;
}

// ─── 4. scope 包含关系（custom admin）────────────────────────

async function isScopeWithinActorRange(
  actor: PermissionActor,
  suffix: PermissionScopeSuffix,
  s: ResourceScope
): Promise<boolean> {
  if (suffix === "all") {
    return true; // 持 .all 蕴含全部 scope
  }
  if (s.scope_type === "all") {
    // 资源声明"全部可见"，actor 必须持 .all 才可写（已在 suffix==='all' 分支处理）
    return false;
  }
  if (suffix === "team") {
    return s.scope_type === "team" && !!actor.teamId && s.scope_id === actor.teamId;
  }
  if (suffix === "dept") {
    if (!actor.deptId) return false;
    if (s.scope_type === "dept") return s.scope_id === actor.deptId;
    if (s.scope_type === "team") {
      // 查 team 所属 dept
      if (!s.scope_id) return false;
      const { data: team } = await db
        .from("teams")
        .select("dept_id")
        .eq("id", s.scope_id)
        .maybeSingle();
      return !!team && team.dept_id === actor.deptId;
    }
    return false; // suffix=dept 不允许 org/all 范围
  }
  if (suffix === "org") {
    if (!actor.tenantCode) return false;
    return isScopeWithinOrg(s, actor.tenantCode);
  }
  return false;
}

/** scope 是否落在某组织内（org_admin 与 custom admin .org 共用） */
async function isScopeWithinOrg(s: ResourceScope, tenantCode: string): Promise<boolean> {
  if (s.scope_type === "all") return false; // 平台全局 ≠ 任一组织内
  if (s.scope_type === "org") return s.scope_id === tenantCode;
  if (s.scope_type === "dept") {
    if (!s.scope_id) return false;
    const { data } = await db
      .from("departments")
      .select("tenant_code")
      .eq("id", s.scope_id)
      .maybeSingle();
    return !!data && data.tenant_code === tenantCode;
  }
  if (s.scope_type === "team") {
    if (!s.scope_id) return false;
    const { data: team } = await db
      .from("teams")
      .select("tenant_code")
      .eq("id", s.scope_id)
      .maybeSingle();
    return !!team && team.tenant_code === tenantCode;
  }
  return false;
}

// ─── 工具：列出 actor 持有的 read scope（list 路径筛选用）────

/**
 * 给 GET /api/admin/workflows 等 list 路径用：
 * 返回 actor 对 read 动作持有的"可见 scope 范围"组合
 *
 * 调用方据此构造 resource_permissions 查询条件（与 org_admin 现有 OR filter 同套）。
 *
 * 注意：同一 actor 同时持有 read.dept 和 read.team 时，按 dept 上位优先（更宽）；
 *      实际 list 路径还会在 hasPermission update 校验里收紧 update 写入范围。
 */
export function listReadableScopes(actor: PermissionActor): {
  all: boolean;
  org: string | null;
  dept: string | null;
  team: string | null;
} {
  if (actor.source !== "custom_admin") {
    // builtin：org_admin 返回 tenantCode；super/system 给 all
    if (actor.builtinRole === "super_admin" || actor.builtinRole === "system_admin") {
      return { all: true, org: null, dept: null, team: null };
    }
    if (actor.builtinRole === "org_admin") {
      return { all: false, org: actor.tenantCode, dept: null, team: null };
    }
    return { all: false, org: null, dept: null, team: null };
  }
  // custom：按持有的 read.* 推（最宽优先）
  const p = actor.permissions;
  if (p.has("workflow.read.all")) return { all: true, org: null, dept: null, team: null };
  if (p.has("workflow.read.org") && actor.tenantCode) {
    return { all: false, org: actor.tenantCode, dept: null, team: null };
  }
  if (p.has("workflow.read.dept") && actor.deptId) {
    return { all: false, org: null, dept: actor.deptId, team: null };
  }
  if (p.has("workflow.read.team") && actor.teamId) {
    return { all: false, org: null, dept: null, team: actor.teamId };
  }
  return { all: false, org: null, dept: null, team: null };
}

// Re-export for convenience
export { PERMISSION_KEYS, isPermissionKey };
export type { PermissionKey } from "@/lib/permission-keys";
