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

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <FontSizeBinder />
      {children}
    </ToastProvider>
  );
}
