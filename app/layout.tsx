import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "前哨AI人机协同工作舱",
  description: "前哨AI人机协同工作舱，由前哨科技（QianShao.AI）提供",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 5.6up · 字体大小 pre-hydration script
  // 在 React hydration 前同步执行，根据 localStorage 设置 zoom，避免大/小档刷新闪动
  // suppressHydrationWarning 必须加，因为脚本会在 client hydration 之前给 <html> 写 inline style
  const fontSizePreHydrationScript = `
try {
  var p = location.pathname;
  var isAdmin = p === '/admin' || p.indexOf('/admin/') === 0;
  var isTrial = p === '/trial' || p.indexOf('/trial/') === 0;
  if (!isAdmin && !isTrial) {
    var v = localStorage.getItem('app_font_size');
    if (v === 'medium') document.documentElement.style.zoom = '1.15';
    else if (v === 'large') document.documentElement.style.zoom = '1.30';
  }
} catch(e) {}
`;

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fontSizePreHydrationScript }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
