"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Building2,
  Bot,
  Megaphone,
  BarChart3,
  FileText,
  LogOut,
  Menu,
  X,
  ChevronRight,
  GitBranch,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/dashboard", label: "控制台", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "组织码管理", icon: Building2 },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/agents", label: "智能体管理", icon: Bot },
  { href: "/admin/workflows", label: "工作流管理", icon: GitBranch },
  { href: "/admin/notices", label: "公告管理", icon: Megaphone },
  { href: "/admin/analytics", label: "用量看板", icon: BarChart3 },
  { href: "/admin/logs", label: "操作日志", icon: FileText },
  { href: "/admin/settings", label: "品牌设置", icon: Settings },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "" });

  useEffect(() => {
    // 先读缓存，立即渲染，避免闪烁
    try {
      const cached = localStorage.getItem("brand_settings_v1");
      if (cached) setSiteSettings(JSON.parse(cached));
    } catch {}
    // 再从接口刷新
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setSiteSettings(d);
        try { localStorage.setItem("brand_settings_v1", JSON.stringify(d)); } catch {}
      })
      .catch(() => {});
  }, []);

  const NavContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-[#002FA7]">
            {siteSettings.logo_url ? (
              <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-xs font-bold">AI</span>
            )}
          </div>
          <div>
            {siteSettings.platform_name ? (
              <p className="text-sm font-semibold text-gray-900">{siteSettings.platform_name}</p>
            ) : (
              <div className="h-4 w-28 bg-gray-100 rounded animate-pulse" />
            )}
            <p className="text-xs text-gray-400">管理后台</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-150",
                active
                  ? "bg-[#002FA7] text-white"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <item.icon size={17} />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={14} />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="p-4 border-t border-gray-100">
        <Link
          href="/admin"
          className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <LogOut size={16} />
          退出登录
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-[#f8f9fc]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-100 fixed inset-y-0 left-0 z-40">
        <NavContent />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-white flex flex-col">
            <button
              className="absolute top-4 right-4"
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} className="text-gray-500" />
            </button>
            <NavContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <div className="lg:hidden bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3 sticky top-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-[8px] hover:bg-gray-100">
            <Menu size={20} className="text-gray-600" />
          </button>
          <span className="font-semibold text-gray-900 text-sm">
            {navItems.find((n) => pathname.startsWith(n.href))?.label ?? "管理后台"}
          </span>
        </div>

        <main className="flex-1 p-4 sm:p-6 page-enter">{children}</main>

        <footer className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100 bg-white">
          © 2026 前哨科技（QianShao.AI）管理后台
        </footer>
      </div>
    </div>
  );
}
