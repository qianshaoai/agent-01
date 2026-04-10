import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-secret-change-in-production-000"
);

const COOKIE_NAME = "ai_portal_token";
const ADMIN_COOKIE_NAME = "ai_portal_admin_token";
const TOKEN_TTL = "30d";

// ─── Token payload types ────────────────────────────────────────────────────

export type UserPayload = {
  type: "user";
  userId: string;
  phone: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
  role: "super_admin" | "system_admin" | "org_admin" | "user";
  userType: "personal" | "organization";
};

export type AdminRole = "super_admin" | "system_admin" | "org_admin";

export type AdminPayload = {
  type: "admin";
  adminId: string;
  username: string;
  role: AdminRole;
  tenantCode?: string | null;  // 组织管理员关联的组织码
};

export type TokenPayload = UserPayload | AdminPayload;

// ─── 角色层级（数字越小权限越高）────────────────────────────
// 可跨 admins 表与 users.role 使用
export const ROLE_RANK: Record<string, number> = {
  super_admin: 0,
  system_admin: 1,
  org_admin: 2,
  user: 3,
};

/**
 * 判断 actor 是否有权将 target 的角色改为 newRole
 * 规则：只能把别人改成**严格低于自己**的角色，且不能改自己的角色
 */
export function canAssignRole(actorRole: AdminRole, newRole: string, isSelf: boolean): boolean {
  if (isSelf) return false;
  const actorRank = ROLE_RANK[actorRole] ?? 99;
  const newRank = ROLE_RANK[newRole] ?? 99;
  return newRank > actorRank;  // newRole 必须严格低于 actorRole
}

/**
 * 判断 actor 是否有权对角色为 targetRole 的人做"删除/禁用/改密码"等管理操作
 * 规则：只能管理严格低于自己的人；super_admin 可以管任何人（包括同级 super）
 */
export function canManageTarget(actorRole: AdminRole, targetRole: string): boolean {
  const actorRank = ROLE_RANK[actorRole] ?? 99;
  const targetRank = ROLE_RANK[targetRole] ?? 99;
  if (actorRole === "super_admin") return true;
  return targetRank > actorRank;
}

// ─── Sign token ──────────────────────────────────────────────────────────────

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(JWT_SECRET);
}

// ─── Verify token ────────────────────────────────────────────────────────────

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// ─── Get current user from cookies (Server Component / API Route) ───────────

export async function getCurrentUser(): Promise<UserPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "user") return null;
  return payload;
}

export async function getCurrentAdmin(): Promise<AdminPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "admin") return null;
  return payload;
}

// ─── Get from request (Middleware / API route) ───────────────────────────────

export async function getPayloadFromRequest(
  req: NextRequest
): Promise<TokenPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// ─── Set/clear cookie helpers ────────────────────────────────────────────────

export function buildSetCookieHeader(token: string): string {
  const maxAge = 30 * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function buildAdminSetCookieHeader(token: string): string {
  const maxAge = 30 * 24 * 60 * 60;
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildAdminClearCookieHeader(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME, ADMIN_COOKIE_NAME };
