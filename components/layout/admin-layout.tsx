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

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  allowedRoles: AdminRole[];
};
type NavGroup = { label: string; items: NavItem[] };
type AdminRole = "super_admin" | "system_admin" | "org_admin";

const ALL_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
const SUPER_SYSTEM: AdminRole[] = ["super_admin", "system_admin"];
const SUPER_ONLY: AdminRole[] = ["super_admin"];

const navGroups: NavGroup[] = [
  {
    label: "概览",
    items: [
      { href: "/admin/dashboard", label: "控制台",   icon: LayoutDashboard, allowedRoles: ALL_ROLES },
      { href: "/admin/analytics", label: "用量看板", icon: BarChart3,       allowedRoles: ALL_ROLES },
    ],
  },
  {
    label: "组织与用户",
    items: [
      { href: "/admin/tenants", label: "组织码管理", icon: Building2, allowedRoles: SUPER_SYSTEM },
      { href: "/admin/users",   label: "用户管理",   icon: Users,     allowedRoles: ALL_ROLES },
    ],
  },
  {
    label: "内容",
    items: [
      { href: "/admin/agents",    label: "智能体管理", icon: Bot,       allowedRoles: SUPER_SYSTEM },
      { href: "/admin/workflows", label: "工作流管理", icon: GitBranch, allowedRoles: SUPER_SYSTEM },
      { href: "/admin/notices",   label: "公告管理",   icon: Megaphone, allowedRoles: ALL_ROLES },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/logs",     label: "操作日志", icon: FileText, allowedRoles: ALL_ROLES },
      { href: "/admin/settings", label: "品牌设置", icon: Settings, allowedRoles: SUPER_ONLY },
    ],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin:  "超级管理员",
  system_admin: "系统管理员",
  org_admin:    "组织管理员",
};

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState(() => {
    if (typeof window === "undefined") return { logo_url: "", platform_name: "" };
    try {
      const cached = localStorage.getItem("brand_settings_v1");
      if (cached) return JSON.parse(cached);
    } catch {}
    return { logo_url: "", platform_name: "" };
  });
  const [adminRole, setAdminRole] = useState<AdminRole>("super_admin");
  const [adminUsername, setAdminUsername] = useState<string>("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setSiteSettings(d);
        try { localStorage.setItem("brand_settings_v1", JSON.stringify(d)); } catch {}
      })
      .catch(() => {});
    // 读取当前管理员角色（实时从数据库，不信任 JWT 缓存）
    let lastRefresh = 0;
    const REFRESH_THROTTLE_MS = 30 * 1000; // 30 秒内不重复拉取
    function refreshMe(force = false) {
      const now = Date.now();
      if (!force && now - lastRefresh < REFRESH_THROTTLE_MS) return;
      lastRefresh = now;
      fetch("/api/admin/me", { cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((me) => {
          if (me?.role) setAdminRole(me.role as AdminRole);
          if (me?.username) setAdminUsername(me.username);
        })
        .catch(() => {});
    }
    refreshMe(true);
    // 窗口聚焦时节流拉取（30 秒内多次聚焦只拉一次）
    const onFocus = () => refreshMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pathname]);

  // 按当前角色过滤导航
  const visibleNavGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.allowedRoles.includes(adminRole)) }))
    .filter((g) => g.items.length > 0);

  const navContent = (
    <>
      {/* Logo 区 */}
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-white/10">
        <div className="w-9 h-9 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-white/15 border border-white/20">
          {siteSettings.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-white text-xs font-bold">AI</span>
          )}
        </div>
        <div className="min-w-0">
          {siteSettings.platform_name ? (
            <p className="text-[14px] font-semibold text-white truncate leading-tight">{siteSettings.platform_name}</p>
          ) : (
            <div className="h-3.5 w-24 bg-white/15 rounded animate-pulse" />
          )}
          <p className="text-[11px] text-white/55 leading-tight mt-0.5">管理后台</p>
        </div>
      </div>

      {/* 当前管理员身份 */}
      {adminUsername && (
        <div className="mx-3 my-3 px-3 py-2 rounded-[10px] bg-white/10 border border-white/15">
          <p className="text-[12px] text-white/60">当前登录</p>
          <p className="text-[13px] font-semibold text-white truncate">{adminUsername}</p>
          <p className="text-[11px] text-white/85 mt-0.5">{ROLE_LABEL[adminRole]}</p>
        </div>
      )}

      {/* 导航 */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-5">
        {visibleNavGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[11px] font-medium text-white/50 tracking-wider uppercase">{group.label}</p>
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
                        ? "bg-white/20 text-white border border-white/25 shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
                        : "text-white/85 hover:bg-white/10 hover:text-white"
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
      <div className="p-3 border-t border-white/10">
        <Link
          href="/admin"
          className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] text-white/85 hover:bg-white/10 hover:text-red-200 transition-colors"
        >
          <LogOut size={15} />
          退出登录
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-app)" }}>
      {/* Desktop sidebar — 与用户端 header 同源深蓝渐变 */}
      <aside className="hidden lg:flex flex-col w-60 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-r border-white/10 fixed inset-y-0 left-0 z-40 shadow-[4px_0_20px_rgba(0,47,167,0.15)]">
        {navContent}
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] flex flex-col">
            <button className="absolute top-4 right-4 z-10" onClick={() => setMobileOpen(false)}>
              <X size={20} className="text-white/80" />
            </button>
            {navContent}
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
