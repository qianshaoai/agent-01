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
  ClipboardList,
  Plug,
  BookOpen,
  Tag,
  KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** builtin admin 路径下的过滤：role 在此列表内才显示 */
  allowedRoles: AdminRole[];
  /**
   * 6.6up · custom admin 路径下的显示规则
   *   - undefined：custom admin 不可见（默认 fail-closed）
   *   - requiredAnyPermissions：custom admin 持有任一列出权限时可见
   *   该字段不影响 builtin admin。
   */
  requiredAnyPermissions?: string[];
};
type NavGroup = { label: string; items: NavItem[] };
type AdminRole = "super_admin" | "system_admin" | "org_admin";
type AccessSource = "admin_table" | "user_admin" | "custom_admin";

const ALL_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
const SUPER_ONLY: AdminRole[] = ["super_admin"];
// 5.30up · org_admin 也能进入但按 ownership 看子集（API 管理 / 知识库管理 等）
// 未来若加新"按 ownership 过滤"的资源页面，复用此常量；区分语义于 ALL_ROLES（全员全见）
// 历史 SS_ROLES（仅 super + system）已废弃 —— 5.14up 的 API 管理 + 5.19up 的知识库
//   原本独占 super + system，5.30up 放权 org_admin 后两个菜单都切到 RBAC_SCOPED_ROLES，
//   无其它消费方，按 lint 要求删除以保持代码清洁。
const RBAC_SCOPED_ROLES: AdminRole[] = ["super_admin", "system_admin", "org_admin"];
// 6.5up · 标签管理仅 super + system（与 isTagAdmin 服务端拦截一致 · org_admin 隐藏菜单）
const TAG_ADMIN_ROLES: AdminRole[] = ["super_admin", "system_admin"];

const navGroups: NavGroup[] = [
  {
    label: "概览",
    items: [
      { href: "/admin/dashboard", label: "控制台",   icon: LayoutDashboard, allowedRoles: ALL_ROLES },
      { href: "/admin/analytics", label: "用量看板", icon: BarChart3,       allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
    ],
  },
  {
    label: "组织与用户",
    items: [
      { href: "/admin/tenants", label: "组织管理", icon: Building2, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["tenant.read.all"] },
      { href: "/admin/users",   label: "用户管理",   icon: Users,     allowedRoles: ALL_ROLES, requiredAnyPermissions: ["user.read.org", "user.read.all"] },
    ],
  },
  {
    label: "内容",
    items: [
      { href: "/admin/model-providers", label: "API 管理",   icon: Plug,      allowedRoles: RBAC_SCOPED_ROLES, requiredAnyPermissions: ["provider.read.org", "provider.read.all"] },
      { href: "/admin/agent-center",    label: "智能体管理", icon: Bot,       allowedRoles: ALL_ROLES, requiredAnyPermissions: ["agent.read.org", "agent.read.all", "agent_draft.read.org", "agent_draft.read.all"] },
      { href: "/admin/knowledge-bases", label: "知识库管理", icon: BookOpen,  allowedRoles: RBAC_SCOPED_ROLES, requiredAnyPermissions: ["kb.read.org", "kb.read.all"] },
      { href: "/admin/workflows",       label: "工作流管理", icon: GitBranch, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["workflow.read.team", "workflow.read.dept", "workflow.read.org", "workflow.read.all", "workflow.create.team", "workflow.create.dept", "workflow.create.org", "workflow.create.all", "workflow.update.team", "workflow.update.dept", "workflow.update.org", "workflow.update.all"] },
      { href: "/admin/tags",            label: "标签管理",   icon: Tag,       allowedRoles: TAG_ADMIN_ROLES, requiredAnyPermissions: ["category.read.all"] },
      { href: "/admin/notices",         label: "公告管理",   icon: Megaphone, allowedRoles: ALL_ROLES, requiredAnyPermissions: ["notice.read.org", "notice.read.all"] },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/logs",       label: "操作日志", icon: FileText,       allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
      { href: "/admin/audit-logs", label: "审计记录", icon: ClipboardList,  allowedRoles: ALL_ROLES, requiredAnyPermissions: ["audit.read.org", "audit.read.all"] },
      // 6.4up · 权限管理（仅超管，custom admin 不可见）
      { href: "/admin/permissions", label: "权限管理", icon: KeyRound,      allowedRoles: SUPER_ONLY },
      { href: "/admin/settings",   label: "品牌设置", icon: Settings,       allowedRoles: SUPER_ONLY },
    ],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin:  "超级管理员",
  system_admin: "系统管理员",
  org_admin:    "组织管理员",
};

export function AdminLayout({
  children,
  fullBleed = false,
  hideFooter = false,
}: {
  children: React.ReactNode;
  /** 让页面自己铺满右侧内容区，不使用后台默认 padding / max-width。适合知识库这类沉浸式页面。 */
  fullBleed?: boolean;
  /** 隐藏默认白色 footer，避免沉浸式页面底部露出白框。 */
  hideFooter?: boolean;
}) {
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
  // 6.5up · 修复后台导航初始角色闪现
  //   旧实现：useState("super_admin") → /api/admin/me 回来前所有角色都按超管渲染，
  //   低权限账号（system_admin / org_admin）首屏会看到 SUPER_ONLY 菜单（如品牌设置），
  //   等 fetch 回来才消失。半秒级闪现 = 权限边界泄露感。
  //   新实现：初始 null → loading skeleton；拿到真实角色后再渲染菜单。
  // 6.4up · 同时拉 accessSource / customPermissions 处理 custom admin 路径
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [accessSource, setAccessSource] = useState<AccessSource | null>(null);
  const [customPermissions, setCustomPermissions] = useState<Set<string>>(new Set());
  const [adminUsername, setAdminUsername] = useState<string>("");
  const [meLoaded, setMeLoaded] = useState<boolean>(false);

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
          if (!me) return;
          setAccessSource((me.source as AccessSource | null) ?? null);
          if (me.source === "custom_admin") {
            // custom admin：不设 adminRole（保持 null，按 requiredAnyPermissions 过滤）
            setAdminRole(null);
            const perms: string[] = Array.isArray(me.permissions) ? me.permissions : [];
            setCustomPermissions(new Set(perms));
          } else if (me.role) {
            setAdminRole(me.role as AdminRole);
            const perms: string[] = Array.isArray(me.permissions) ? me.permissions : [];
            setCustomPermissions(new Set(perms));
          }
          if (me.username) setAdminUsername(me.username);
          setMeLoaded(true);
        })
        .catch(() => {});
    }
    refreshMe(true);
    // 窗口聚焦时节流拉取（30 秒内多次聚焦只拉一次）
    const onFocus = () => refreshMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pathname]);

  // 6.6up · 按当前 actor 过滤导航（builtin 按 allowedRoles；custom 按 requiredAnyPermissions）
  //   builtin 分支等价 6.5up 旧逻辑（adminRole null → 全部不可见 → 由 skeleton 兜）
  function navItemVisible(it: NavItem): boolean {
    if (accessSource === "custom_admin") {
      if (it.requiredAnyPermissions?.some((p) => customPermissions.has(p))) return true;
      return false; // 默认 fail-closed
    }
    // builtin admin
    if (!adminRole) return false;
    return it.allowedRoles.includes(adminRole);
  }
  const visibleNavGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter(navItemVisible) }))
    .filter((g) => g.items.length > 0);
  // custom admin 无任何可见菜单 → 给主区域兜底页（避免空白窗）
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

      {/* 当前管理员身份（username 与 role 同一个 fetch 回来，双守卫保类型安全 + 避免空 role 时角色名渲染异常）
          6.4up · custom admin 的 adminRole 恒 null，需放行 accessSource==='custom_admin' 否则身份卡片不显示 */}
      {adminUsername && (adminRole || accessSource === "custom_admin") && (
        <div className="mx-3 my-3 px-3 py-2 rounded-[10px] bg-white/10 border border-white/15">
          <p className="text-[12px] text-white/60">当前登录</p>
          <p className="text-[13px] font-semibold text-white truncate">{adminUsername}</p>
          <p className="text-[11px] text-white/85 mt-0.5">
            {accessSource === "custom_admin"
              ? "自定义角色"
              : adminRole
                ? ROLE_LABEL[adminRole]
                : ""}
          </p>
        </div>
      )}

      {/* 导航 */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-5">
        {/* me 加载前 skeleton（6.5up 防闪现 + 6.4up custom admin 适配）：
            custom admin 的 adminRole 恒 null，故按 meLoaded 而非 adminRole 判，否则骨架永不消失 */}
        {!meLoaded ? (
          <div className="space-y-5 px-1 pt-2" aria-hidden>
            {[6, 5, 4].map((n, gi) => (
              <div key={gi}>
                <div className="h-3 w-14 mx-3 mb-2 bg-white/10 rounded animate-pulse" />
                <div className="space-y-1">
                  {Array.from({ length: n }).map((_, i) => (
                    <div key={i} className="h-8 mx-1 bg-white/10 rounded-[10px] animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : visibleNavGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[11px] font-medium text-white/50 tracking-wider uppercase">{group.label}</p>
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
            {currentNavLabel}
          </span>
        </div>

        <main
          className={
            fullBleed
              ? "flex-1 w-full"
              : "flex-1 p-5 sm:p-7 max-w-[1600px] w-full mx-auto"
          }
        >
          {showCustomFallback ? (
            <div className="max-w-md mx-auto mt-24 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#002FA7]/10 mb-4">
                <KeyRound size={28} />
              </div>
              <h2 className="text-[18px] font-semibold text-gray-900 mb-2">尚未配置后台权限</h2>
              <p className="text-[13px] text-gray-500 leading-relaxed">
                你的账号通过自定义角色进入了后台，但当前角色暂未授予可用菜单的权限。<br />
                请联系超级管理员为你的角色添加 workflow 等权限。
              </p>
            </div>
          ) : (
            children
          )}
        </main>

        {!hideFooter && (
          <footer className="px-6 py-3 text-[11px] text-gray-400 border-t border-gray-100 bg-white">
            © 2026 前哨科技（QianShao.AI）管理后台
          </footer>
        )}
      </div>
    </div>
  );
}
