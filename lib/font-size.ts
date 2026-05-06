/**
 * 5.6up · 全应用字体大小切换（zoom 整页缩放方案 P2）
 *
 * 工作流：
 *   - 用户在 /settings 选大/中/小，写 localStorage `app_font_size`
 *   - <Providers> 里挂的 <FontSizeBinder /> 监听 pathname 变化，调用 applyFontSize
 *   - applyFontSize 根据当前路径 + 偏好，决定写或清 document.documentElement.style.zoom
 *   - admin / trial 路径下永远清 zoom（这两个模块不受影响）
 *   - 首屏闪动通过 app/layout.tsx <head> 里的 pre-hydration script 解决
 */

export type FontSize = "small" | "medium" | "large";

export const FONT_SIZE_KEY = "app_font_size";

// 映射口径：原默认字号 = 用户感受的"小"；中 / 大 在此基础上放大
const ZOOM_MAP: Record<FontSize, string> = {
  small: "", // 空字符串 = 清掉 inline style，回到原默认（用户认为这就是"小"）
  medium: "1.15",
  large: "1.30",
};

/** 读 localStorage 当前偏好；非法值或未设置 → "small"（保持原默认体感） */
export function getFontSize(): FontSize {
  if (typeof window === "undefined") return "small";
  try {
    const v = window.localStorage.getItem(FONT_SIZE_KEY);
    if (v === "small" || v === "medium" || v === "large") return v;
  } catch {}
  return "small";
}

/** 写 localStorage + 立即应用（在用户端路径下）。在设置页 onChange 里调用 */
export function setFontSize(size: FontSize, pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FONT_SIZE_KEY, size);
  } catch {}
  applyFontSize(pathname);
}

/**
 * 路径感知：
 *   - admin / trial 路径下永远清 zoom
 *   - 其它路径按偏好应用
 *
 * 路径判断严格用 === 或 startsWith('/x/')，避免 /administrator 误判
 */
export function applyFontSize(pathname: string): void {
  if (typeof document === "undefined") return;

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isTrial = pathname === "/trial" || pathname.startsWith("/trial/");

  if (isAdmin || isTrial) {
    document.documentElement.style.zoom = "";
    return;
  }

  const size = getFontSize();
  document.documentElement.style.zoom = ZOOM_MAP[size];
}
