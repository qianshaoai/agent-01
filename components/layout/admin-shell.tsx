"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ClipboardList,
  FileText,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Plug,
  Settings,
  Tag,
  Users,
  X,
} from "lucide-react";
import {
  type AdminRole,
  type AdminSource,
  useAdminSession,
} from "@/components/admin/admin-session-provider";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  allowedRoles: AdminRole[];
  requiredAnyPermissions?: string[];
};
type NavGroup = { label: string; items: NavItem[] };

const ALL_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
const SUPER_ONLY: AdminRole[] = ["super_admin"];
const RBAC_SCOPED_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
const TAG_ADMIN_ROLES: AdminRole[] = ["super_admin", "system_admin"];

const navGroups: NavGroup[] = [
  {
    label: "概览",
    items: [
      { href: "/admin/dashboard", label: "控制台", icon: LayoutDashboard, allowedRoles: ALL_ROLES },
      { href: "/admin/analytics", label: "用量看板", icon: BarChart3, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
    ],
  },
  {
    label: "组织与用户",
    items: [
      { href: "/admin/tenants", label: "组织管理", icon: Building2, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["tenant.read.all"] },
      { href: "/admin/users", label: "用户管理", icon: Users, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["user.read.org", "user.read.all"] },
    ],
  },
  {
    label: "内容",
    items: [
      { href: "/admin/model-providers", label: "API 管理", icon: Plug, allowedRoles: RBAC_SCOPED_ROLES, requiredAnyPermissions: ["provider.read.org", "provider.read.all"] },
      { href: "/admin/agent-center", label: "智能体管理", icon: Bot, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["agent.read.org", "agent.read.all", "agent_draft.read.org", "agent_draft.read.all"] },
      { href: "/admin/knowledge-bases", label: "知识库管理", icon: BookOpen, allowedRoles: RBAC_SCOPED_ROLES, requiredAnyPermissions: ["kb.read.org", "kb.read.all"] },
      { href: "/admin/workflows", label: "工作流管理", icon: GitBranch, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["workflow.read.team", "workflow.read.dept", "workflow.read.org", "workflow.read.all", "workflow.create.team", "workflow.create.dept", "workflow.create.org", "workflow.create.all", "workflow.update.team", "workflow.update.dept", "workflow.update.org", "workflow.update.all"] },
      { href: "/admin/tags", label: "标签管理", icon: Tag, allowedRoles: TAG_ADMIN_ROLES, requiredAnyPermissions: ["category.read.all"] },
      { href: "/admin/notices", label: "公告管理", icon: Megaphone, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["notice.read.org", "notice.read.all"] },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/logs", label: "操作日志", icon: FileText, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
      { href: "/admin/audit-logs", label: "审计记录", icon: ClipboardList, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
      { href: "/admin/permissions", label: "权限管理", icon: KeyRound, allowedRoles: SUPER_ONLY },
      { href: "/admin/settings", label: "品牌设置", icon: Settings, allowedRoles: SUPER_ONLY },
    ],
  },
];

const flatNav = navGroups.flatMap((group) => group.items);
const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "超级管理员",
  system_admin: "系统管理员",
  org_admin: "组织管理员",
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, siteSettings, status, stale, error, refresh } = useAdminSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  const adminRole = (me?.role ?? me?.builtinRole ?? null) as AdminRole | null;
  const accessSource = (me?.source ?? null) as AdminSource | null;
  const permissions = new Set(me?.permissions ?? []);
  const meLoaded = status === "ready" || (status === "error" && me !== null);

  function navItemVisible(item: NavItem): boolean {
    if (accessSource === "custom_admin") {
      return item.requiredAnyPermissions?.some((permission) => permissions.has(permission)) ?? false;
    }
    return adminRole ? item.allowedRoles.includes(adminRole) : false;
  }

  const visibleNavGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter(navItemVisible) }))
    .filter((group) => group.items.length > 0);
  const showCustomFallback =
    meLoaded && accessSource === "custom_admin" && visibleNavGroups.length === 0;

  function isNavActive(item: NavItem): boolean {
    if (item.href === "/admin/agent-center") {
      return (
        pathname === item.href ||
        pathname.startsWith(`${item.href}/`) ||
        pathname.startsWith("/admin/agent-builder") ||
        pathname.startsWith("/admin/agents")
      );
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  const currentNavLabel = flatNav.find(isNavActive)?.label ?? "管理后台";
  const navContent = (
    <>
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-white/10">
        <div className="w-9 h-9 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-white/15 border border-white/20">
          {siteSettings.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(siteSettings.logo_url)} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-white text-xs font-bold">AI</span>
          )}
        </div>
        <div className="min-w-0">
          {siteSettings.platform_name ? (
            <p className="text-[14px] font-semibold text-white truncate leading-tight">
              {String(siteSettings.platform_name)}
            </p>
          ) : (
            <div className="h-3.5 w-24 bg-white/15 rounded animate-pulse" />
          )}
          <p className="text-[11px] text-white/55 leading-tight mt-0.5">管理后台</p>
        </div>
      </div>

      {me?.username && (adminRole || accessSource === "custom_admin") && (
        <div className="mx-3 my-3 px-3 py-2 rounded-[10px] bg-white/10 border border-white/15">
          <p className="text-[12px] text-white/60">当前登录</p>
          <p className="text-[13px] font-semibold text-white truncate">{me.username}</p>
          <p className="text-[11px] text-white/85 mt-0.5">
            {accessSource === "custom_admin"
              ? "自定义角色"
              : adminRole
                ? ROLE_LABEL[adminRole]
                : ""}
          </p>
        </div>
      )}

      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-5">
        {!meLoaded ? (
          <div className="space-y-5 px-1 pt-2" aria-hidden>
            {[6, 5, 4].map((count, groupIndex) => (
              <div key={groupIndex}>
                <div className="h-3 w-14 mx-3 mb-2 bg-white/10 rounded animate-pulse" />
                <div className="space-y-1">
                  {Array.from({ length: count }).map((_, itemIndex) => (
                    <div key={itemIndex} className="h-8 mx-1 bg-white/10 rounded-[10px] animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          visibleNavGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-[11px] font-medium text-white/50 tracking-wider uppercase">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isNavActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-all duration-150 relative group",
                        active
                          ? "bg-white/20 text-white border border-white/25 shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
                          : "text-white/85 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <item.icon size={16} />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>

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
      <aside className="hidden lg:flex flex-col w-60 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-r border-white/10 fixed inset-y-0 left-0 z-40 shadow-[4px_0_20px_rgba(0,47,167,0.15)]">
        {navContent}
      </aside>

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

      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <div className="lg:hidden bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3 sticky top-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-[8px] hover:bg-gray-100">
            <Menu size={20} className="text-gray-600" />
          </button>
          <span className="font-semibold text-gray-900 text-sm">{currentNavLabel}</span>
        </div>

        {status === "error" && (
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <span>{stale ? "管理员信息暂时刷新失败，当前继续使用上一次成功状态。" : error}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100"
            >
              重试
            </button>
          </div>
        )}

        <main className="flex-1 w-full">
          {status === "loading" || status === "unauthenticated" ? (
            <div className="mx-auto max-w-6xl px-6 py-8" aria-busy="true" aria-label="正在加载管理员会话">
              <div className="h-8 w-40 rounded-lg bg-gray-100 animate-pulse" />
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-32 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            </div>
          ) : status === "error" && !me ? (
            <div className="max-w-md mx-auto mt-24 px-6 text-center">
              <KeyRound size={32} className="mx-auto mb-4 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-900">管理员会话加载失败</h2>
              <p className="mt-2 text-sm text-gray-500">{error}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-5 rounded-lg bg-[#002FA7] px-4 py-2 text-sm font-medium text-white hover:bg-[#00237a]"
              >
                重试
              </button>
            </div>
          ) : status === "forbidden" ? (
            <div className="max-w-md mx-auto mt-24 px-6 text-center">
              <KeyRound size={32} className="mx-auto mb-4 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">无权访问管理后台</h2>
              <p className="mt-2 text-sm text-gray-500">{error}</p>
            </div>
          ) : showCustomFallback ? (
            <div className="max-w-md mx-auto mt-24 px-6 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#002FA7]/10 mb-4">
                <KeyRound size={28} />
              </div>
              <h2 className="text-[18px] font-semibold text-gray-900 mb-2">尚未配置后台权限</h2>
              <p className="text-[13px] text-gray-500 leading-relaxed">
                你的账号通过自定义角色进入了后台，但当前角色暂未授予可用菜单的权限。
                <br />
                请联系超级管理员为你的角色添加 workflow 等权限。
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
