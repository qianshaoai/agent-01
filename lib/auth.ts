import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "fallback-secret-change-in-production-000"
);

const COOKIE_NAME = "ai_portal_token";
const ADMIN_COOKIE_NAME = "ai_portal_admin_token";
const TOKEN_TTL = "7d";

// ─── Token payload types ────────────────────────────────────────────────────

export type UserPayload = {
  type: "user";
  userId: string;
  phone: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
};

export type AdminPayload = {
  type: "admin";
  adminId: string;
  username: string;
};

export type TokenPayload = UserPayload | AdminPayload;

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
  const maxAge = 7 * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function buildAdminSetCookieHeader(token: string): string {
  const maxAge = 7 * 24 * 60 * 60;
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function buildAdminClearCookieHeader(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME, ADMIN_COOKIE_NAME };
