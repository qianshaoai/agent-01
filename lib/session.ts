import {
  getCurrentUser,
  getCurrentAdmin,
  getCurrentAdminAccess,
  UserPayload,
  AdminPayload,
  AdminRole,
  AdminAccessPayload,
  isCustomAdminPayload,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import {
  buildPermissionActor,
  hasPermission,
  PermissionActor,
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
  return getCurrentAdminAccess();
}

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
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  // custom admin firstLogin 处理：custom admin 走 users 表，由前置 elevate / login 强制改密 + freshness 把关
  // builtin admin firstLogin 仍走 requireAdmin 同款守门（access 路径不重复实现，避免逻辑分叉）
  if (!isCustomAdminPayload(access) && (access as AdminPayload).firstLogin === true) {
    return apiError(
      "首次登录需先修改初始密码，请回登录页完成密码修改",
      "FORBIDDEN",
    );
  }
  const actor = await buildPermissionActor(access);
  const ok = await hasPermission(actor, permissionKey);
  if (!ok) return apiError("无此操作权限", "FORBIDDEN");
  return actor;
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
