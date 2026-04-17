import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, ADMIN_COOKIE_NAME, verifyToken } from "@/lib/auth";

// 需要登录才能访问的用户路由
const USER_PROTECTED = ["/", "/agents", "/settings", "/user-agents"];
// 需要管理员才能访问的路由
const ADMIN_PROTECTED = [
  "/admin/dashboard",
  "/admin/tenants",
  "/admin/agents",
  "/admin/workflows",
  "/admin/notices",
  "/admin/analytics",
  "/admin/logs",
  "/admin/settings",
  "/admin/users",
];

let reqCounter = 0;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── API 请求日志 ─────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    const requestId = `${Date.now().toString(36)}-${(reqCounter++ % 0xFFFF).toString(16).padStart(4, "0")}`;
    const start = Date.now();

    const res = NextResponse.next();
    res.headers.set("X-Request-Id", requestId);

    // 结构化日志（method、path、requestId）
    // 注意：middleware 拿不到响应状态码，耗时在 afterResponse 里也不精确
    // 但足够做请求追踪和排查
    console.log("[API]", JSON.stringify({
      requestId,
      method: req.method,
      path: pathname,
      timestamp: new Date().toISOString(),
    }));

    return res;
  }

  // ── 管理端路由保护 ────────────────────────────────────────────
  if (ADMIN_PROTECTED.some((p) => pathname.startsWith(p))) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload || payload.type !== "admin") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }

  // ── 用户路由保护 ──────────────────────────────────────────────
  if (
    USER_PROTECTED.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    )
  ) {
    const payload = await getPayloadFromRequest(req);
    if (!payload || payload.type !== "user") {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
