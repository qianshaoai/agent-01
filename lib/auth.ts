import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/config";
import { db } from "@/lib/db";

// JWT_SECRET 必须在环境变量中配置，缺失时立即报错防止使用不安全的默认值
const JWT_SECRET_RAW = process.env.JWT_SECRET;
if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET 环境变量未配置或长度不足 32 字符，拒绝启动");
  } else {
    console.warn("[auth] 警告：JWT_SECRET 未配置或长度不足 32 字符，仅 dev 环境使用临时密钥");
  }
}
const JWT_SECRET = new TextEncoder().encode(
  JWT_SECRET_RAW && JWT_SECRET_RAW.length >= 32
    ? JWT_SECRET_RAW
    : "dev-only-fallback-please-set-JWT_SECRET-in-env-" + "x".repeat(20)
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
  userType: "personal" | "organization" | "trial";
  /** JWT iat（jose 解出来自带，类型显式声明便于 validateTokenFreshness 使用） */
  iat?: number;
};

export type AdminRole = "super_admin" | "system_admin" | "org_admin";

export type AdminPayload = {
  type: "admin";
  adminId: string;
  username: string;
  role: AdminRole;
  tenantCode?: string | null;  // 组织管理员关联的组织码
  /** JWT iat（同上） */
  iat?: number;
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

// ─── Token 新鲜度校验 (5.6up · 强制重登机制) ────────────────────────────────
//
// 用于"修改用户所属组织"等需要立即让某个登录态失效的场景。
// 流程：admin 触发后端写 users.force_relogin_at = NOW()，所有该用户已签发的 token
// 由于 iat < force_relogin_at 会被本函数判为失效，下一次任何请求中间件 / 业务接口
// 都会清 cookie + 重定向登录。
//
// 返回 true = token 仍新鲜可用；false = 已被强制失效（应清 cookie + 重定向）。

/** 用户 token 新鲜度校验 */
export async function validateUserTokenFreshness(
  payload: UserPayload
): Promise<boolean> {
  if (!payload.iat) return true; // 无 iat 字段（极少见）→ 不阻塞
  try {
    const { data } = await db
      .from("users")
      .select("force_relogin_at")
      .eq("id", payload.userId)
      .single();
    if (!data || !data.force_relogin_at) return true;
    const tokenIatMs = payload.iat * 1000;
    const forceAtMs = new Date(data.force_relogin_at).getTime();
    return tokenIatMs >= forceAtMs;
  } catch {
    return true; // DB 查询失败时不阻塞业务，宁可放行
  }
}

/** Admin token 新鲜度校验（同样机制，对应 admins.force_relogin_at） */
export async function validateAdminTokenFreshness(
  payload: AdminPayload
): Promise<boolean> {
  if (!payload.iat) return true;
  try {
    const { data } = await db
      .from("admins")
      .select("force_relogin_at")
      .eq("id", payload.adminId)
      .single();
    if (!data || !data.force_relogin_at) return true;
    const tokenIatMs = payload.iat * 1000;
    const forceAtMs = new Date(data.force_relogin_at).getTime();
    return tokenIatMs >= forceAtMs;
  } catch {
    return true;
  }
}

// ─── Get current user from cookies (Server Component / API Route) ───────────

export async function getCurrentUser(): Promise<UserPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "user") return null;
  // 强制重登检查
  const fresh = await validateUserTokenFreshness(payload);
  if (!fresh) return null;
  return payload;
}

export async function getCurrentAdmin(): Promise<AdminPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "admin") return null;
  const fresh = await validateAdminTokenFreshness(payload);
  if (!fresh) return null;
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

const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";

export function buildSetCookieHeader(token: string): string {
  const maxAge = AUTH.COOKIE_MAX_AGE_SEC;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`;
}

export function buildAdminSetCookieHeader(token: string): string {
  const maxAge = AUTH.COOKIE_MAX_AGE_SEC;
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie}`;
}

export function buildAdminClearCookieHeader(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`;
}

export { COOKIE_NAME, ADMIN_COOKIE_NAME };

// ─── Trial 守卫 helpers（4.28up 体验版模块）─────────────────────────────────
//
// 调用约定：返回 NextResponse 表示已拦截（调用方直接 return 即可）；
//          返回 null 表示通过，继续执行业务逻辑。

/** 拦截体验账号访问正式业务接口（user-JWT 接口入口处统一调用） */
export function requireFullUser(payload: TokenPayload | null): NextResponse | null {
  if (!payload || payload.type !== "user") {
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (payload.userType === "trial") {
    return NextResponse.json(
      { error: "体验账号不可调用此接口", code: "FORBIDDEN" },
      { status: 403 }
    );
  }
  return null;
}

/** 拦截非体验账号访问体验版接口（/api/trial/* 入口处统一调用） */
export function requireTrialUser(payload: TokenPayload | null): NextResponse | null {
  if (!payload || payload.type !== "user") {
    return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (payload.userType !== "trial") {
    return NextResponse.json(
      { error: "非体验账号不可调用此接口", code: "FORBIDDEN" },
      { status: 403 }
    );
  }
  return null;
}
