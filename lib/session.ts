import { getCurrentUser, getCurrentAdmin, UserPayload, AdminPayload, AdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-error";

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
 */
export async function requireAdmin(): Promise<AdminPayload | Response> {
  const admin = await getActiveAdmin();
  if (!admin) return apiError("未登录或权限已变更", "UNAUTHORIZED");
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
