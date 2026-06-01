import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ZoomFit } from "@/components/zoom-fit";

export const metadata: Metadata = {
  title: "前哨AI人机协同工作舱",
  description: "前哨AI人机协同工作舱，由前哨科技（QianShao.AI）提供",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 5.7up · 字体大小 pre-hydration script
  // 在 React hydration 前同步执行，根据 localStorage 设置 <html> 的 data-font-size 属性
  // globals.css 通过 :root[data-font-size] 选择器调整 root font-size
  // suppressHydrationWarning 必须加，因为脚本会在 client hydration 之前给 <html> 写属性
  const fontSizePreHydrationScript = `
try {
  var h = document.documentElement;
  // 6.1up R1.5 · scale-to-fit · 整页 zoom 缩放（基准 1920px）
  //   pre-hydration 同步设置初始 zoom 避免 FOUC，后续 resize 由 ZoomFit 组件监听更新
  //   5.7up 曾用 zoom 做字体大小切换、后弃用；6.1up 用 zoom 做整页等比缩放是 zoom 本意
  var w = window.innerWidth || document.documentElement.clientWidth;
  h.style.zoom = String(Math.min(1, w / 1920));
  var p = location.pathname;
  var isAdmin = p === '/admin' || p.indexOf('/admin/') === 0;
  var isTrial = p === '/trial' || p.indexOf('/trial/') === 0;
  if (!isAdmin && !isTrial) {
    var v = localStorage.getItem('app_font_size');
    if (v === 'medium' || v === 'large') h.setAttribute('data-font-size', v);
  }
} catch(e) {}
`;

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fontSizePreHydrationScript }} />
      </head>
      <body className="antialiased">
        <ZoomFit />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
