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
  GitBranch,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups: { label: string; items: { href: string; label: string; icon: React.ComponentType<{ size?: number }> }[] }[] = [
  {
    label: "概览",
    items: [
      { href: "/admin/dashboard", label: "控制台", icon: LayoutDashboard },
      { href: "/admin/analytics", label: "用量看板", icon: BarChart3 },
    ],
  },
  {
    label: "组织与用户",
    items: [
      { href: "/admin/tenants", label: "组织码管理", icon: Building2 },
      { href: "/admin/users", label: "用户管理", icon: Users },
    ],
  },
  {
    label: "内容",
    items: [
      { href: "/admin/agents", label: "智能体管理", icon: Bot },
      { href: "/admin/workflows", label: "工作流管理", icon: GitBranch },
      { href: "/admin/notices", label: "公告管理", icon: Megaphone },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/logs", label: "操作日志", icon: FileText },
      { href: "/admin/settings", label: "品牌设置", icon: Settings },
    ],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "" });

  useEffect(() => {
    try {
      const cached = localStorage.getItem("brand_settings_v1");
      if (cached) setSiteSettings(JSON.parse(cached));
    } catch {}
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
      {/* Logo 区 */}
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-gray-100">
        <div className="w-9 h-9 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-[#002FA7]">
          {siteSettings.logo_url ? (
            <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-white text-xs font-bold">AI</span>
          )}
        </div>
        <div className="min-w-0">
          {siteSettings.platform_name ? (
            <p className="text-[14px] font-semibold text-gray-900 truncate leading-tight">{siteSettings.platform_name}</p>
          ) : (
            <div className="h-3.5 w-24 bg-gray-100 rounded animate-pulse" />
          )}
          <p className="text-[11px] text-gray-400 leading-tight mt-0.5">管理后台</p>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[11px] font-medium text-gray-400 tracking-wider uppercase">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-150 relative group",
                      active
                        ? "bg-[#002FA7] text-white shadow-sm"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    )}
                  >
                    <item.icon size={16} />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 退出 */}
      <div className="p-3 border-t border-gray-100">
        <Link
          href="/admin"
          className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] text-gray-500 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <LogOut size={15} />
          退出登录
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-app)" }}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-gray-100 fixed inset-y-0 left-0 z-40">
        <NavContent />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-white flex flex-col">
            <button className="absolute top-4 right-4 z-10" onClick={() => setMobileOpen(false)}>
              <X size={20} className="text-gray-500" />
            </button>
            <NavContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <div className="lg:hidden bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3 sticky top-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-[8px] hover:bg-gray-100">
            <Menu size={20} className="text-gray-600" />
          </button>
          <span className="font-semibold text-gray-900 text-sm">
            {flatNav.find((n) => pathname.startsWith(n.href))?.label ?? "管理后台"}
          </span>
        </div>

        <main className="flex-1 p-5 sm:p-7 page-enter max-w-[1600px] w-full mx-auto">{children}</main>

        <footer className="px-6 py-3 text-[11px] text-gray-400 border-t border-gray-100 bg-white">
          © 2026 前哨科技（QianShao.AI）管理后台
        </footer>
      </div>
    </div>
  );
}
