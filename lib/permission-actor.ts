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

// 6.4up v2 Phase A · 是否进入 v2 effective set 合成路径
//   - 任一 resource 在 PERMISSION_V2_ENFORCE_RESOURCES CSV 出现 → builtin admin actor 构建时
//     额外查 builtin_role_permissions + admin_permission_overrides 合成 effective set
//   - 6.6up：空 / 未设 / all → 默认全资源 enforce，加载 effective set
//   - none → 跳过查询，effectivePermissions 留空集（hasPermission builtin 路径走旧 role-based fallback）
//   这是 6.6up 「none 回滚，其余默认生效」的对应实现：actor 层也按 flag 决定是否查 v2 两表，
//   避免空 flag 时无意义的 DB 往返
function isPermissionV2Enabled(): boolean {
  const flag = (process.env.PERMISSION_V2_ENFORCE_RESOURCES ?? "all").trim().toLowerCase();
  return flag !== "none";
}

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
  /**
   * 6.4up v2 Phase A R1 · builtin admin v2 通道是否已加载 effective set
   *   - true：v2 enforce 启用 + DB 查询成功 → hasPermission builtin 路径走新公式
   *     （effectivePermissions 可能为空 set = 显式无权，不再隐式回退）
   *   - false：env 空 / super_admin（不走 enforce） / custom_admin（不用此字段）
   *     → hasPermission builtin 路径走旧 role-based fallback
   * v2 启用 + DB 查询失败 → buildBuiltinAdminActor throw（fail-closed），不会构造出
   * v2Loaded=false 的 actor 假装"未启用"。
   */
  v2Loaded: boolean;
  /**
   * 6.4up v2 Phase A · builtin admin 的 v2 通道 effective permission set
   *   = builtin_role_permissions[role] ∪ admin_permission_overrides[grant] - admin_permission_overrides[revoke]
   * 仅在 v2Loaded=true 时参与判定；v2Loaded=false 时为空 set 占位。
   */
  effectivePermissions: Set<string>;
  /** 用户名（供审计日志用，buildPermissionActor 顺手取出） */
  username: string;
};

export type PrefetchedPermissionActorProfile =
  | {
      source: "admin_table";
      row: {
        id: string;
        username: string | null;
        tenant_code: string | null;
        role: AdminRole | null;
        force_relogin_at?: string | null;
      };
    }
  | {
      source: "user_admin" | "custom_admin";
      row: {
        id: string;
        username: string | null;
        phone: string | null;
        tenant_code: string | null;
        dept_id: string | null;
        team_id: string | null;
        user_type: string | null;
        role?: AdminRole | "user" | null;
        status: string;
        force_relogin_at?: string | null;
      };
      tenantValid?: boolean;
    };

export type ResourceScope = {
  scope_type: "all" | "org" | "dept" | "team";
  scope_id: string | null;
};

// ─── 1. buildPermissionActor ─────────────────────────────────

export async function buildPermissionActor(
  payload: AdminAccessPayload,
  prefetchedProfile?: PrefetchedPermissionActorProfile,
): Promise<PermissionActor> {
  if (isCustomAdminPayload(payload)) {
    return buildCustomAdminActor(payload, prefetchedProfile);
  }
  return buildBuiltinAdminActor(payload as AdminPayload, prefetchedProfile);
}

async function buildBuiltinAdminActor(
  p: AdminPayload,
  prefetchedProfile?: PrefetchedPermissionActorProfile,
): Promise<PermissionActor> {
  // 先查 admins 表（admin_table 路径）
  const adminRow = prefetchedProfile?.source === "admin_table"
    ? prefetchedProfile.row
    : (await db
        .from("admins")
        .select("id, username, tenant_code, role")
        .eq("id", p.adminId)
        .maybeSingle()).data;
  if (adminRow) {
    const builtinRole = (adminRow.role as AdminRole | null) ?? p.role;
    const v2 = await loadEffectivePermissions("admin_table", p.adminId, builtinRole);
    return {
      actorId: p.adminId,
      source: "admin_table",
      tenantCode: adminRow.tenant_code ?? p.tenantCode ?? null,
      deptId: null,
      teamId: null,
      userType: null,
      builtinRole,
      customRoleCodes: [],
      permissions: new Set<PermissionKey>(),
      v2Loaded: v2.kind === "loaded",
      effectivePermissions: v2.kind === "loaded" ? v2.set : new Set<string>(),
      username: adminRow.username ?? p.username,
    };
  }
  // 再查 users 表（user_admin 路径，5.11up 起 users.role 提升模式）
  const userRow = prefetchedProfile?.source === "user_admin"
    ? prefetchedProfile.row
    : (await db
        .from("users")
        .select("id, username, phone, tenant_code, dept_id, team_id, user_type, role")
        .eq("id", p.adminId)
        .maybeSingle()).data;
  if (userRow) {
    const builtinRole = (userRow.role as AdminRole | null) ?? p.role;
    const v2 = await loadEffectivePermissions("user_admin", p.adminId, builtinRole);
    return {
      actorId: p.adminId,
      source: "user_admin",
      tenantCode: userRow.tenant_code ?? p.tenantCode ?? null,
      deptId: userRow.dept_id ?? null,
      teamId: userRow.team_id ?? null,
      userType: (userRow.user_type as "personal" | "organization" | null) ?? null,
      builtinRole,
      customRoleCodes: [],
      permissions: new Set<PermissionKey>(),
      v2Loaded: v2.kind === "loaded",
      effectivePermissions: v2.kind === "loaded" ? v2.set : new Set<string>(),
      username: userRow.username ?? userRow.phone ?? p.username,
    };
  }
  // 双源都查不到 → fallback 到 JWT payload（与 getActiveAdmin 一致的容错策略）
  // 不查 v2 两表（这是兜底状态，v2 enforce 不应在此分支命中）
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
    v2Loaded: false,
    effectivePermissions: new Set<string>(),
    username: p.username,
  };
}

// 6.4up v2 Phase A R1 · builtin admin effective permissions 合成
//   = builtin_role_permissions[role] ∪ admin_permission_overrides[grant] - admin_permission_overrides[revoke]
//
// 返回 tagged union 把 "未启用 / 加载成功（可能空） / 加载失败" 三态分开：
//   - skipped：v2 未启用 / super_admin / 无 role → hasPermission builtin 路径走旧 fallback
//   - loaded：v2 启用 + DB 查询成功（set 可能为空 = 显式无权，不再隐式回退到旧权限）
//   - failed：v2 启用 + DB 查询失败 → 上抛错；buildBuiltinAdminActor 不 catch，actor 构建失败，
//             调用方框架默认返 500（fail-closed；按 R1 决策 D1）
type V2Load =
  | { kind: "skipped" }
  | { kind: "loaded"; set: Set<string> };

async function loadEffectivePermissions(
  source: "admin_table" | "user_admin",
  actorId: string,
  builtinRole: AdminRole | null,
): Promise<V2Load> {
  // super_admin 公式第 1 行硬全权，不需要查；v2 enforce 未启用时也不查
  if (!builtinRole || builtinRole === "super_admin" || !isPermissionV2Enabled()) {
    return { kind: "skipped" };
  }

  const [pack, overrides] = await Promise.all([
    db.from("builtin_role_permissions").select("permission_key").eq("role", builtinRole),
    db
      .from("admin_permission_overrides")
      .select("permission_key, effect")
      .eq("admin_source", source)
      .eq("admin_id", actorId),
  ]);

  // 任一查询失败 → fail-closed（throw 让 actor 构建失败 / 上游 500）
  // 不再返空 set 让 hasPermission 走旧 fallback 假装放权
  if (pack.error || overrides.error) {
    throw new Error(
      `[permission-actor] v2 enforce 启用但加载 effective permissions 失败：` +
      `pack.error=${pack.error?.message ?? "ok"} overrides.error=${overrides.error?.message ?? "ok"}`
    );
  }

  const eff = new Set<string>();
  for (const r of (pack.data ?? []) as { permission_key: string }[]) {
    eff.add(r.permission_key);
  }
  type Ov = { permission_key: string; effect: "grant" | "revoke" };
  const ovs = (overrides.data ?? []) as Ov[];
  for (const o of ovs) {
    if (o.effect === "grant") eff.add(o.permission_key);
    else if (o.effect === "revoke") eff.delete(o.permission_key);
  }
  return { kind: "loaded", set: eff };
}

async function buildCustomAdminActor(
  p: CustomAdminPayload,
  prefetchedProfile?: PrefetchedPermissionActorProfile,
): Promise<PermissionActor> {
  const [{ data: userRow }, { data: roleRows }] = await Promise.all([
    prefetchedProfile?.source === "custom_admin"
      ? Promise.resolve({ data: prefetchedProfile.row })
      : db
          .from("users")
          .select("id, username, phone, tenant_code, dept_id, team_id, user_type, status")
          .eq("id", p.userId)
          .maybeSingle(),
    db
      .from("user_custom_roles")
      .select("role_id, custom_roles!inner(code, enabled)")
      .eq("user_id", p.userId),
  ]);

  // R2 Fix 2 兜底 · 即使 freshness 已挡，buildActor 也独立校验一遍：
  //   - 用户不存在 / 非 active → 返回空 permissions（actor 拿不到任何能力 → hasPermission 必拒）
  //   - 用户绑定组织且 tenant disabled/expired → 同样返回空 permissions
  // 这是防御深度：万一未来新增"未走 freshness 的 access 链路"，actor 层也不会越权。
  const emptyActor = (reason: string): PermissionActor => ({
    actorId: p.userId,
    source: "custom_admin",
    tenantCode: null,
    deptId: null,
    teamId: null,
    userType: null,
    builtinRole: null,
    customRoleCodes: [],
    permissions: new Set<PermissionKey>(),
    v2Loaded: false,
    effectivePermissions: new Set<string>(),
    username: `${p.username} (denied: ${reason})`,
  });

  if (!userRow) return emptyActor("user_not_found");
  if ((userRow as { status: string }).status !== "active") return emptyActor("user_not_active");

  // tenant 状态兜底校验（与 freshness 同口径）
  const tc = userRow.tenant_code;
  if (
    tc &&
    tc !== "PERSONAL" &&
    prefetchedProfile?.source === "custom_admin" &&
    prefetchedProfile.tenantValid === false
  ) {
    return emptyActor("tenant_inactive");
  }
  if (
    tc &&
    tc !== "PERSONAL" &&
    !(prefetchedProfile?.source === "custom_admin" && prefetchedProfile.tenantValid === true)
  ) {
    const { data: tenant } = await db
      .from("tenants")
      .select("enabled, expires_at")
      .eq("code", tc)
      .maybeSingle();
    if (!tenant) return emptyActor("tenant_not_found");
    if (!tenant.enabled) return emptyActor("tenant_disabled");
    if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) {
      return emptyActor("tenant_expired");
    }
  }

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
    tenantCode: userRow.tenant_code ?? null,
    deptId: userRow.dept_id ?? null,
    teamId: userRow.team_id ?? null,
    userType: (userRow.user_type as "personal" | "organization" | null) ?? null,
    builtinRole: null,
    customRoleCodes,
    permissions,
    // custom 通道判定走 permissions（custom_role_permissions），不用 v2 两表
    v2Loaded: false,
    effectivePermissions: new Set<string>(),
    username: userRow.username ?? userRow.phone ?? p.username,
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
  // ─── 公式第 1 行：super_admin 硬全权 ───────────────────────────
  if (actor.builtinRole === "super_admin") return true;

  // ─── builtin admin 路径 ────────────────────────────────────────
  // 6.4up v2 Phase A R1 · 模式开关用 actor.v2Loaded（显式），不再用 effectivePermissions.size：
  //   - v2Loaded=true：走新公式（空 set = 显式无权，不再隐式回退）
  //   - v2Loaded=false：v2 enforce 未启用 → 退回旧 role-based fallback（保 6.4up 行为）
  // DB 查询失败的"假装未启用"路径在 buildBuiltinAdminActor → loadEffectivePermissions
  // 已改为 throw（fail-closed），不会构造出 v2Loaded=false 的 actor 在 enforce 时充数。
  if (actor.source !== "custom_admin") {
    const role = actor.builtinRole;
    if (!role) return false;

    if (actor.v2Loaded) {
      // v2 公式路径：finalKeys.has(key) && scopeOk
      if (!actor.effectivePermissions.has(key)) return false;
      const suffix = getPermissionScopeSuffix(key);
      if (!targetScopes || targetScopes.length === 0) return true;
      for (const s of targetScopes) {
        const ok = await isScopeWithinActorRange(actor, suffix, s);
        if (!ok) return false;
      }
      return true;
    }

    // 旧 role-based fallback（v2 enforce 未启用时；零行为变化）
    const resource = getPermissionResource(key);
    if (role === "system_admin" && resource === "workflow") return true;
    if (role === "org_admin" && resource === "workflow") {
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

  // ─── custom admin 路径（v50 通道，与 v2 表完全无关） ───────────
  if (!actor.permissions.has(key)) return false;
  const suffix = getPermissionScopeSuffix(key);
  if (!targetScopes || targetScopes.length === 0) {
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
