import {
  getCurrentUser,
  getCurrentAdmin,
  UserPayload,
  AdminPayload,
  AdminRole,
  AdminAccessPayload,
  isCustomAdminPayload,
  getUnvalidatedCurrentAdminAccess,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import {
  buildPermissionActor,
  hasPermission,
  PermissionActor,
  PrefetchedPermissionActorProfile,
  ResourceScope,
} from "@/lib/permission-actor";
import { PermissionKey } from "@/lib/permission-keys";

// UserPayload enriched with DB-fresh status and nickname.
// Use this in API routes that must enforce account status.
export type ActiveUser = UserPayload & {
  nickname: string;
  status: "active";
  createdAt: string | null;
};

export async function getActiveUser(): Promise<ActiveUser | null> {
  const payload = await getCurrentUser();
  if (!payload) return null;

  const { data: dbUser, error: dbErr } = await db
    .from("users")
    .select("status, nickname, created_at, role, user_type")
    .eq("id", payload.userId)
    .single();

  // 5.12up bug fix · Supabase 偶发网络/超时错误时不要踢用户下线
  // 旧逻辑：data=null 直接 return null → /api/me 401 → 心跳 15s 整页跳 /login
  // 现在：DB 查询失败时 fallback 到 JWT payload（视为 active），与 validateUserTokenFreshness
  // 那边"catch 后 return true"的兜底策略保持一致
  if (dbErr) {
    return {
      ...payload,
      nickname: "",
      status: "active" as const,
      createdAt: null,
    };
  }

  // DB 查到了：以 DB 的 status 为准（disabled / deleted / cancelled 都视为下线）
  if (!dbUser || dbUser.status !== "active") return null;

  return {
    ...payload,
    // role 和 userType 从数据库实时读取，不依赖 JWT
    role: dbUser.role ?? "user",
    userType: dbUser.user_type ?? "personal",
    nickname: dbUser.nickname ?? "",
    status: "active" as const,
    createdAt: dbUser.created_at ?? null,
  };
}

// AdminPayload enriched with DB-fresh role and tenantCode.
// 用于所有需要实时校验角色/数据范围的后台接口。
export async function getActiveAdmin(): Promise<AdminPayload | null> {
  const payload = await getCurrentAdmin();
  if (!payload) return null;

  // 先尝试从 admins 表读最新 role（内置管理员）
  const { data: dbAdmin, error: dbAdminErr } = await db
    .from("admins")
    .select("role, tenant_code")
    .eq("id", payload.adminId)
    .single();

  // 5.12up bug fix · Supabase 偶发错误时不踢下线（跟 getActiveUser 同策略）
  // dbAdminErr 不仅包含"未找到"（PGRST116），还可能是真正的网络/超时错误
  // 这里先尝试用户表分支兜底；若用户表也错，再 fallback 到 JWT payload
  if (dbAdmin) {
    const VALID_ADMIN_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
    if (!dbAdmin.role || !VALID_ADMIN_ROLES.includes(dbAdmin.role as AdminRole)) return null;
    return {
      ...payload,
      role: dbAdmin.role as AdminRole,
      tenantCode: dbAdmin.tenant_code ?? null,
    };
  }

  // 再尝试 users 表（普通用户被提升为管理员）
  const { data: dbUser, error: dbUserErr } = await db
    .from("users")
    .select("role, tenant_code, status")
    .eq("id", payload.adminId)
    .single();

  // 两张表都查询出错（不是"未找到"，而是真的网络/超时错误）
  // 这种情况下放行，让 JWT 自己决定有效性
  if (dbAdminErr && dbUserErr && !dbUser) {
    return payload;
  }

  if (!dbUser) return null;
  // 被禁用/删除/注销的用户立即失去后台访问权
  if (dbUser.status !== "active") return null;
  // 角色降级为普通用户 → 立即踢出
  if (!["super_admin", "system_admin", "org_admin"].includes(dbUser.role)) return null;

  return {
    ...payload,
    role: dbUser.role as AdminRole,
    tenantCode: dbUser.role === "org_admin" ? (dbUser.tenant_code ?? null) : null,
  };
}

/**
 * 鉴权辅助：要求管理员登录，否则返回 401 Response。
 * 用法：
 *   const result = await requireAdmin();
 *   if (result instanceof Response) return result;
 *   const admin = result; // AdminPayload
 *
 * 5.28up 小B 复审 R3 Fix 1 · 强制改密码闸门：
 *   admin token 含 `firstLogin=true` 时（admin/login 对 first_login=true 的非超管签
 *   发的）默认 403 拒绝；防 admin 拿初始密码登录后直接调业务 API。
 *   仅 `/api/admin/change-password` 调用时传 `{ allowFirstLogin: true }` 豁免 ——
 *   让用户能完成首次改密码。其它所有 admin API 调用不传此参数即可。
 */
export async function requireAdmin(opts?: { allowFirstLogin?: boolean }): Promise<AdminPayload | Response> {
  const admin = await getActiveAdmin();
  if (!admin) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  if (admin.firstLogin === true && opts?.allowFirstLogin !== true) {
    return apiError(
      "首次登录需先修改初始密码，请回登录页完成密码修改",
      "FORBIDDEN",
    );
  }
  return admin;
}

/**
 * 鉴权辅助：要求用户登录，否则返回 401 Response。
 */
export async function requireUser(): Promise<ActiveUser | Response> {
  const user = await getActiveUser();
  if (!user) return apiError("未登录", "UNAUTHORIZED");
  return user;
}

// ─── 6.4up · 权限管理 · access payload + requirePermission ───
//
// 双通道（方案 R1.2 § 双通道权限模型）：
//   - requireAdmin() ↑ 仍只接受 builtin admin（admin_table / user_admin）
//   - getAdminAccessPayload() / requirePermission() ↓ 同时接受 custom admin
//
// 接入约定：custom admin 可达的所有 /api/admin/* 必须走 requirePermission(key)；
//          未改造的旧接口继续 requireAdmin()，custom admin 进不去 → fail-closed。

/**
 * 取当前请求的 access payload（builtin 或 custom 都返回）。
 * 用于 /api/admin/me、admin/login 复签、elevate-to-admin 等场景。
 */
export async function getAdminAccessPayload(): Promise<AdminAccessPayload | null> {
  const context = await resolveAdminRequestContext();
  return context instanceof Response ? null : context.access;
}

export type AdminActorContext = {
  access: AdminAccessPayload;
  actor: PermissionActor;
  /** builtin: adminId; custom: userId */
  adminId: string;
  username: string;
  role: AdminRole | "custom_admin";
  /** actor/source tenant, if any */
  tenantCode: string | null;
  source: "admin_table" | "user_admin" | "custom_admin";
  isCustomAdmin: boolean;
};

/**
 * 6.6up · 后台 actor 统一入口。
 *
 * requireAdmin() 只接受 builtin admin；6.6up 后绝大多数业务接口需要同时接受
 * builtin admin 与 custom_admin，因此统一通过 access payload 构造 PermissionActor。
 */
function tokenIsFresh(iat: number | undefined, forceReloginAt: string | null | undefined): boolean {
  if (!iat || !forceReloginAt) return true;
  return iat * 1000 >= new Date(forceReloginAt).getTime();
}

async function requireActiveBuiltinOrg(
  role: string | null | undefined,
  tenantCode: string | null | undefined,
): Promise<true | Response> {
  if (role !== "org_admin") return true;
  if (!tenantCode) return apiError("组织管理员缺少所属组织", "UNAUTHORIZED");
  const { data: tenant, error } = await db
    .from("tenants")
    .select("enabled, expires_at")
    .eq("code", tenantCode)
    .maybeSingle();
  if (error) {
    console.error("[admin context builtin tenant]", error.code, error.message);
    return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
  }
  if (
    !tenant?.enabled ||
    (tenant.expires_at && new Date(tenant.expires_at).getTime() < Date.now())
  ) {
    return apiError("组织已停用或过期", "UNAUTHORIZED");
  }
  return true;
}

/**
 * 单次请求统一解析后台管理员上下文：
 * JWT 验签后只读取一次主资料，再加载权限；不再先 freshness 查询、随后重复读取同一资料。
 */
export async function resolveAdminRequestContext(): Promise<AdminActorContext | Response> {
  const access = await getUnvalidatedCurrentAdminAccess();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");

  if (!isCustomAdminPayload(access) && (access as AdminPayload).firstLogin === true) {
    return apiError(
      "首次登录需先修改初始密码，请回登录页完成密码修改",
      "FORBIDDEN",
    );
  }

  const isCustom = isCustomAdminPayload(access);
  let profile: PrefetchedPermissionActorProfile | null = null;

  if (isCustom) {
    const { data: userRow, error } = await db
      .from("users")
      .select(
        "id, username, phone, tenant_code, dept_id, team_id, user_type, role, status, force_relogin_at",
      )
      .eq("id", access.userId)
      .maybeSingle();
    if (error) {
      console.error("[admin context custom profile]", error.code, error.message);
      return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
    }
    if (
      !userRow ||
      userRow.status !== "active" ||
      !tokenIsFresh(access.iat, userRow.force_relogin_at)
    ) {
      return apiError("未登录或权限已变更", "UNAUTHORIZED");
    }

    let tenantValid = true;
    if (userRow.tenant_code && userRow.tenant_code !== "PERSONAL") {
      const { data: tenant, error: tenantError } = await db
        .from("tenants")
        .select("enabled, expires_at")
        .eq("code", userRow.tenant_code)
        .maybeSingle();
      if (tenantError) {
        console.error("[admin context custom tenant]", tenantError.code, tenantError.message);
        return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
      }
      tenantValid = Boolean(
        tenant?.enabled &&
        (!tenant.expires_at || new Date(tenant.expires_at).getTime() >= Date.now()),
      );
    }
    if (!tenantValid) return apiError("组织已停用或过期", "UNAUTHORIZED");
    profile = { source: "custom_admin", row: userRow, tenantValid };
  } else {
    const builtin = access as AdminPayload;
    let source: "admin_table" | "user_admin" = builtin.source ?? "admin_table";
    if (source === "admin_table") {
      const { data: adminRow, error } = await db
        .from("admins")
        .select("id, username, tenant_code, role, force_relogin_at")
        .eq("id", builtin.adminId)
        .maybeSingle();
      if (error) {
        console.error("[admin context admin profile]", error.code, error.message);
        return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
      }
      if (adminRow) {
        if (
          !["super_admin", "system_admin", "org_admin"].includes(adminRow.role) ||
          !tokenIsFresh(builtin.iat, adminRow.force_relogin_at)
        ) {
          return apiError("未登录或权限已变更", "UNAUTHORIZED");
        }
        const tenantStatus = await requireActiveBuiltinOrg(
          adminRow.role,
          adminRow.tenant_code,
        );
        if (tenantStatus instanceof Response) return tenantStatus;
        profile = { source: "admin_table", row: adminRow };
      } else if (!builtin.source) {
        source = "user_admin";
      } else {
        return apiError("未登录或权限已变更", "UNAUTHORIZED");
      }
    }

    if (source === "user_admin") {
      const { data: userRow, error } = await db
        .from("users")
        .select(
          "id, username, phone, tenant_code, dept_id, team_id, user_type, role, status, force_relogin_at",
        )
        .eq("id", builtin.adminId)
        .maybeSingle();
      if (error) {
        console.error("[admin context user profile]", error.code, error.message);
        return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
      }
      if (
        !userRow ||
        userRow.status !== "active" ||
        !["super_admin", "system_admin", "org_admin"].includes(userRow.role) ||
        !tokenIsFresh(builtin.iat, userRow.force_relogin_at)
      ) {
        return apiError("未登录或权限已变更", "UNAUTHORIZED");
      }
      const tenantStatus = await requireActiveBuiltinOrg(
        userRow.role,
        userRow.tenant_code,
      );
      if (tenantStatus instanceof Response) return tenantStatus;
      profile = { source: "user_admin", row: userRow };
    }
  }

  if (!profile) return apiError("管理员上下文加载失败", "INTERNAL_ERROR");
  const actor = await buildPermissionActor(access, profile);
  return {
    access,
    actor,
    adminId: actor.actorId,
    username: actor.username,
    role: isCustom ? "custom_admin" : actor.builtinRole ?? (access as AdminPayload).role,
    tenantCode: actor.tenantCode,
    source: actor.source,
    isCustomAdmin: isCustom,
  };
}

export const requireAdminActor = resolveAdminRequestContext;

/**
 * 鉴权辅助：业务接口要求 actor 持有 permissionKey 才能执行。
 *
 * 用法（建议在 PATCH/DELETE 路径上对每个目标资源也调一次 hasPermission 做 scope 校验）：
 *   const result = await requirePermission("workflow.update.team");
 *   if (result instanceof Response) return result;
 *   const actor = result;
 *   // 拿目标 workflow 的 scopes，再调 hasPermission(actor, key, targetScopes) 收紧校验
 *
 * 401 → 未登录 / token 失效；
 * 403 → 登录有效但无此权限。
 */
export async function requirePermission(
  permissionKey: PermissionKey
): Promise<PermissionActor | Response> {
  const context = await requireAdminActor();
  if (context instanceof Response) return context;
  const ok = await hasPermission(context.actor, permissionKey);
  if (!ok) return apiError("无此操作权限", "FORBIDDEN");
  return context.actor;
}

/**
 * 同 requirePermission 但允许调用方提供 targetScopes 一并校验
 * （update/delete 已知目标 scope 的路径常用 —— 一步到位，避免业务层重复 build actor）。
 */
export async function requirePermissionForScopes(
  permissionKey: PermissionKey,
  targetScopes: ResourceScope[]
): Promise<PermissionActor | Response> {
  const result = await requirePermission(permissionKey);
  if (result instanceof Response) return result;
  const actor = result;
  const ok = await hasPermission(actor, permissionKey, targetScopes);
  if (!ok) return apiError("无此操作权限（目标资源超出权限范围）", "FORBIDDEN");
  return actor;
}
