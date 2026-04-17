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

  const { data: dbUser } = await db
    .from("users")
    .select("status, nickname, created_at, role, user_type")
    .eq("id", payload.userId)
    .single();

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
  const { data: dbAdmin } = await db
    .from("admins")
    .select("role, tenant_code")
    .eq("id", payload.adminId)
    .single();

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
  const { data: dbUser } = await db
    .from("users")
    .select("role, tenant_code, status")
    .eq("id", payload.adminId)
    .single();

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
