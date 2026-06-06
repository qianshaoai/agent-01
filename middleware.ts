import { NextRequest, NextResponse } from "next/server";
import {
  getPayloadFromRequest,
  ADMIN_COOKIE_NAME,
  verifyToken,
  validateUserTokenFreshness,
  validateAdminTokenFreshness,
  validateCustomAdminTokenFreshness,
  isCustomAdminPayload,
  COOKIE_NAME,
} from "@/lib/auth";

// 需要登录才能访问的用户路由
const USER_PROTECTED = ["/", "/agents", "/settings", "/user-agents", "/trial", "/workflows"];

// 5.28up R4 Fix 1 · 管理端路由保护改为"所有 /admin/* 子路径"
//   旧实现是白名单 [/admin/dashboard, /admin/tenants, ...]，但 admin-layout 导航
//   里还有 /admin/model-providers / agent-builder / knowledge-bases / audit-logs 等
//   新页面没加进去，导致 firstLogin=true 的 admin 仍能直接打开这些页面壳（虽然
//   requireAdmin 已经挡了 API、看不到数据，但页面壳能进 = 闸门没闭合）。
//   改成 "/admin/" 开头一律保护，只排除 /admin 这个登录页本身。
function isAdminProtectedPage(pathname: string): boolean {
  // /admin 是登录页，不保护
  // /admin/任意子路径 全部保护（dashboard / tenants / agents / workflows / notices /
  //   analytics / logs / settings / users / model-providers / agent-builder /
  //   knowledge-bases / audit-logs / ... 任何未来新增的也自动覆盖）
  return pathname.startsWith("/admin/");
}

let reqCounter = 0;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── API 请求日志 ─────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    const requestId = `${Date.now().toString(36)}-${(reqCounter++ % 0xFFFF).toString(16).padStart(4, "0")}`;

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
  if (isAdminProtectedPage(pathname)) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token) : null;
    if (!payload || payload.type !== "admin") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    // 6.4up · custom admin 也在此通道（同一 cookie），但走自己的 freshness + 无 firstLogin 概念
    if (isCustomAdminPayload(payload)) {
      const fresh = await validateCustomAdminTokenFreshness(payload);
      if (!fresh) {
        const res = NextResponse.redirect(new URL("/admin", req.url));
        res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
        return res;
      }
      // custom admin 没有 firstLogin（不存在 admins 表 first_login 字段语义）
      // 页面层 admin-layout 会按 permission 把 nav 全部隐藏；无菜单时显示兜底页
      return NextResponse.next();
    }
    // builtin admin · 5.6up · 强制重登检查
    const fresh = await validateAdminTokenFreshness(payload);
    if (!fresh) {
      const res = NextResponse.redirect(new URL("/admin", req.url));
      res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      return res;
    }
    // 5.28up 小B 复审 R3 Fix 1 · 强制改密码闸门：
    //   admin token 含 firstLogin=true（admin/login 首次登录签发的）→ 直接踢回
    //   /admin（登录/改密码页），不允许进任何 ADMIN_PROTECTED 页面。
    //   要走完 /admin 的"首次登录 · 修改密码"分支 → /api/admin/change-password
    //   重签 token 后才能进。
    if (payload.firstLogin === true) {
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
    // 5.6up · 强制重登检查
    const fresh = await validateUserTokenFreshness(payload);
    if (!fresh) {
      const res = NextResponse.redirect(new URL("/login", req.url));
      res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
      return res;
    }
    // 体验账号只允许停留在 /trial（4.28up）
    if (payload.userType === "trial" && !pathname.startsWith("/trial")) {
      return NextResponse.redirect(new URL("/trial", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
