/**
 * 5.7up · 全应用字体大小切换（root font-size 方案）
 *
 * 工作流：
 *   - 用户在 /settings 或主页 header 字体下拉选大/中/小，写 localStorage `app_font_size`
 *   - <Providers> 里 <FontSizeBinder /> 监听 pathname 变化，调用 applyFontSize
 *   - applyFontSize 根据当前路径 + 偏好，写或清 <html> 的 data-font-size 属性
 *   - globals.css 通过 :root[data-font-size="medium|large"] 调整 root font-size
 *   - admin / trial 路径下永远移除属性（这两个模块不受影响）
 *   - 首屏闪动通过 app/layout.tsx <head> 里的 pre-hydration script 解决
 *
 * 与之前 zoom 方案的区别：
 *   - zoom 是整页等比缩放，文字 / padding / 间距全都跟着放大 → 界面变挤
 *   - 现在只改 root font-size，Tailwind 的 text-xs/sm/base/lg 等 rem 单位会自动跟着；
 *     padding / margin / 卡片宽度等保持不变 → 布局密度不变
 *   - 注意：项目里大量使用 text-[NNpx] 任意值，这种硬 px 不会跟着缩放（路径 A 的局限）
 */

export type FontSize = "small" | "medium" | "large";

export const FONT_SIZE_KEY = "app_font_size";

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
 *   - admin / trial 路径下永远清 data-font-size（保持默认）
 *   - 其它路径按偏好写属性
 *   - small 也清属性（让 :root 走默认 17px，不必用属性匹配）
 *
 * 路径判断严格用 === 或 startsWith('/x/')，避免 /administrator 误判
 */
export function applyFontSize(pathname: string): void {
  if (typeof document === "undefined") return;

  const html = document.documentElement;
  // 兼容旧版本（zoom 方案）残留：清掉 inline zoom
  if (html.style.zoom) html.style.zoom = "";

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const isTrial = pathname === "/trial" || pathname.startsWith("/trial/");

  if (isAdmin || isTrial) {
    html.removeAttribute("data-font-size");
    return;
  }

  const size = getFontSize();
  if (size === "small") {
    html.removeAttribute("data-font-size"); // 走默认
  } else {
    html.setAttribute("data-font-size", size);
  }
}
