"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ToastProvider } from "@/components/ui/toast";
import { applyFontSize, FONT_SIZE_KEY } from "@/lib/font-size";

/**
 * 5.6up · 字体大小路由感知绑定器
 *
 * - 路径变化 → 重新应用 zoom（admin/trial 清空，其它按偏好）
 * - storage 事件 → 多 tab 同步：另一个 tab 改了字体偏好，本 tab 立刻跟上
 */
function FontSizeBinder() {
  const pathname = usePathname();

  useEffect(() => {
    applyFontSize(pathname);
  }, [pathname]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FONT_SIZE_KEY) {
        applyFontSize(window.location.pathname);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return null;
}

/**
 * 5.6up · 用户端登录态心跳（force_relogin_at 即时踢出）
 *
 * 每 15 秒静默调 /api/me：
 *   - 200：登录有效，啥也不做
 *   - 401：force_relogin_at 已生效（admin 改了所属组织等），自动整页跳登录
 *
 * 路径白名单：仅在用户端常驻页面工作（主页 / agents / settings / user-agents）。
 * 排除：/login、/register、/admin（admin 走自己 cookie）、/trial（trial 账号
 * 调 /api/me 会 403，不应该被当成"未登录"踢出）。
 */
function UserSessionHeartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    // 路径白名单
    const isProtectedUserPath =
      pathname === "/" ||
      pathname.startsWith("/agents") ||
      pathname === "/settings" ||
      pathname.startsWith("/settings/") ||
      pathname.startsWith("/user-agents");
    if (!isProtectedUserPath) return;

    let stopped = false;
    const HEARTBEAT_MS = 15_000;

    async function check() {
      if (stopped) return;
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (stopped) return;
        if (res.status === 401) {
          // force_relogin 失效，整页跳登录（不用 router.push 避免软导航命中缓存）
          window.location.href = "/login";
        }
      } catch {
        // 网络错误不踢出（比如临时断网）
      }
    }

    // 进入页面立即检查一次（其实 middleware 已经检查过，但开个保险）
    // 然后周期性检查
    const timer = window.setInterval(check, HEARTBEAT_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <FontSizeBinder />
      <UserSessionHeartbeat />
      {children}
    </ToastProvider>
  );
}
