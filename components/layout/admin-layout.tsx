"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/dashboard", label: "控制台", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "企业码管理", icon: Building2 },
  { href: "/admin/agents", label: "智能体管理", icon: Bot },
  { href: "/admin/notices", label: "公告管理", icon: Megaphone },
  { href: "/admin/analytics", label: "用量看板", icon: BarChart3 },
  { href: "/admin/logs", label: "操作日志", icon: FileText },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[10px] bg-[#002FA7] flex items-center justify-center">
            <span className="text-white text-xs font-bold">AI</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">AI 智能体平台</p>
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
          © 2024 前哨科技（QianShao.AI）管理后台
        </footer>
      </div>
    </div>
  );
}
