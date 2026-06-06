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
  /**
   * 5.28up 小B 复审 R3 Fix 1 · 强制改密码闸门
   * - admin/login 在 `users.first_login=true` + non-super_admin 时签 token 带此字段
   * - middleware：见 firstLogin=true → 重定向 /admin（改密码页）；防直接访问 /admin/dashboard 绕过
   * - requireAdmin：firstLogin=true 默认拒绝（FORBIDDEN）；仅 change-password 路由传 allowFirstLogin=true 豁免
   * - change-password 成功改密后重签 token 不带此字段，闸门解除
   */
  firstLogin?: boolean;
  /**
   * 6.4up · 权限管理 · access source 区分
   * - 'admin_table'：admins 表的内置管理员（默认 admin 账号等）
   * - 'user_admin'：users 表 role∈三档 admin 的提升用户
   * 仅做语义标注，不影响 requireAdmin / hasPermission 的内置管理员判定逻辑（builtin 等价）。
   * 历史 token 无此字段 → 视为 'admin_table'（兼容默认）。
   */
  source?: "admin_table" | "user_admin";
  /** JWT iat（同上） */
  iat?: number;
};

/**
 * 6.4up · 权限管理 · custom admin 访问令牌
 *
 * 与 AdminPayload 完全分离的形态（方案 R1.2 P0-4 / P0-6 双通道隔离）：
 *   - 没有 adminId / role / tenantCode（custom admin 不在 builtin 等级体系内）
 *   - 旧代码里的 `admin.role ?? "super_admin"` / `role ?? "super_admin"` 兜底
 *     看不到这个 payload —— 因为 requireAdmin() 会先把它拒掉
 *   - 仅在显式接入 requirePermission() 的接口里被识别
 *
 * source='custom_admin' 是唯一可信判别字段（type='admin' 与 AdminPayload 重叠）。
 */
export type CustomAdminPayload = {
  type: "admin";
  source: "custom_admin";
  userId: string;
  username: string;
  /** JWT iat */
  iat?: number;
};

/**
 * 访问令牌的全集：requireAdmin() 路径只接受 AdminPayload；
 * requirePermission() / getAdminAccessPayload() 路径接受 AdminAccessPayload。
 */
export type AdminAccessPayload = AdminPayload | CustomAdminPayload;

export type TokenPayload = UserPayload | AdminAccessPayload;

/** 类型守卫：判别 access payload 是否为 custom admin */
export function isCustomAdminPayload(p: TokenPayload): p is CustomAdminPayload {
  return p.type === "admin" && (p as CustomAdminPayload).source === "custom_admin";
}

/** 类型守卫：判别 access payload 是否为内置 admin（builtin） */
export function isBuiltinAdminPayload(p: TokenPayload): p is AdminPayload {
  return p.type === "admin" && (p as CustomAdminPayload).source !== "custom_admin";
}

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

/**
 * Admin token 新鲜度校验
 * - 原生管理员（admins 表）→ 比对 admins.force_relogin_at
 * - 被提升为管理员的普通用户（users 表，token.adminId === users.id）→ 回退比对 users.force_relogin_at
 *   这条路径是 change-password route 对 users 表管理员改密时写的字段，必须一并查
 */
export async function validateAdminTokenFreshness(
  payload: AdminPayload
): Promise<boolean> {
  if (!payload.iat) return true;
  try {
    const { data: adminRow } = await db
      .from("admins")
      .select("force_relogin_at")
      .eq("id", payload.adminId)
      .single();

    let forceAt: string | null = adminRow?.force_relogin_at ?? null;
    if (!adminRow) {
      const { data: userRow } = await db
        .from("users")
        .select("force_relogin_at")
        .eq("id", payload.adminId)
        .single();
      forceAt = userRow?.force_relogin_at ?? null;
    }

    if (!forceAt) return true;
    const tokenIatMs = payload.iat * 1000;
    const forceAtMs = new Date(forceAt).getTime();
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
  // 6.4up · 双通道隔离：custom_admin 不进入 builtin admin 通道
  // requireAdmin() 调本函数后会得到 null，自然 401；防 custom admin 误入
  // 任何 `requireAdmin()` 守门的 /api/admin/* 路由。
  if (isCustomAdminPayload(payload)) return null;
  const fresh = await validateAdminTokenFreshness(payload);
  if (!fresh) return null;
  return payload;
}

/**
 * 6.4up · 取当前请求的 access payload（builtin 或 custom 均收）
 *
 * 用法：requirePermission() / /api/admin/me / elevate-to-admin 复签等
 *      需要识别 custom admin 的场景调本函数；其它老接口继续用 getCurrentAdmin()。
 */
export async function getCurrentAdminAccess(): Promise<AdminAccessPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || payload.type !== "admin") return null;
  if (isCustomAdminPayload(payload)) {
    const fresh = await validateCustomAdminTokenFreshness(payload);
    if (!fresh) return null;
    return payload;
  }
  const fresh = await validateAdminTokenFreshness(payload);
  if (!fresh) return null;
  return payload;
}

/**
 * 6.4up · custom admin token 新鲜度
 *
 * custom admin 的 actorId 是 users.id，所以直接比对 users.force_relogin_at。
 * 与 validateAdminTokenFreshness 第二条路径同口径，但因为 payload 形态不同（无 adminId）
 * 单独拉一个函数避免在 freshness 函数里塞 union 判别。
 *
 * R2 Fix 2 · 三层校验（小B 验收 P0-2 + R2.1 兜底）：
 *   1. users.status 必须 'active'（禁用/注销/删除 → 立即失效）
 *   2. force_relogin_at 比较（与 builtin 同口径）
 *   3. 若用户绑定组织（tenant_code 非 PERSONAL）→ 该组织必须 enabled 且未过期
 *
 * DB 真错（网络/超时）→ 沿用项目"宁可放行不踢用户"的 5.12up 兜底策略 return true；
 * 但若查到数据明确不通过 → 返回 false。
 */
export async function validateCustomAdminTokenFreshness(
  payload: CustomAdminPayload
): Promise<boolean> {
  if (!payload.iat) {
    // 无 iat 仍要补做 status / tenant 校验（虽然实际签发时一定有 iat）
  }
  try {
    const { data, error } = await db
      .from("users")
      .select("force_relogin_at, status, tenant_code")
      .eq("id", payload.userId)
      .single();
    if (error || !data) return false; // 用户不存在 → cookie 立即失效

    // ① status active 闸
    if (data.status !== "active") return false;

    // ② force_relogin_at 闸
    if (data.force_relogin_at && payload.iat) {
      const tokenIatMs = payload.iat * 1000;
      const forceAtMs = new Date(data.force_relogin_at).getTime();
      if (tokenIatMs < forceAtMs) return false;
    }

    // ③ tenant 启用 / 过期 闸（仅 org 用户；PERSONAL / NULL 跳过）
    const tc = data.tenant_code;
    if (tc && tc !== "PERSONAL") {
      const { data: tenant } = await db
        .from("tenants")
        .select("enabled, expires_at")
        .eq("code", tc)
        .single();
      if (!tenant) return false;
      if (!tenant.enabled) return false;
      if (tenant.expires_at && new Date(tenant.expires_at) < new Date()) return false;
    }

    return true;
  } catch {
    // 真异常（网络/超时）→ 不阻塞，与 validateAdminTokenFreshness 同策略
    return true;
  }
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
