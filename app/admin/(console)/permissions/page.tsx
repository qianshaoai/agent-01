"use client";
/**
 * 6.4up v2 Phase B · 权限管理 Tab 容器
 *
 * 2 Tab（6.6up 合并）：
 *   1. 角色管理（= 内置角色「系统/组织管理员」默认包编辑[双护栏弹窗] + 自定义角色 CRUD；
 *      原「角色模板」「自定义角色」两 tab 合并，见 components/permissions/v2/tab-custom-roles.tsx
 *      + role-default-pack-modal.tsx）
 *   2. 权限审计（audit_logs 三类资源筛选）
 *
 * 6.6up 历史：「个人权限」tab 已隐藏（后端 admin-overrides/admin-effective/builtin-admins 接口
 *   与 admin_permission_overrides 表保留不动、可逆）；「角色模板」并入角色管理（tab-templates.tsx
 *   逻辑已被 role-default-pack-modal 复用，旧文件留存不引用）。
 *
 * URL 同步：?tab=custom-roles|audit（默认 custom-roles；旧 personal/templates 书签回落默认）
 *   - 浏览器前进/后退保留状态
 *   - 深链分享
 *
 * 权限：super_admin only（页面级 AdminSessionProvider 兜底 + 各 Tab API 服务端 super 强制）
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminPageFrame as AdminLayout } from "@/components/layout/admin-layout";
import { useAdminSession } from "@/components/admin/admin-session-provider";
import { PageHeader } from "@/components/ui/page-header";
import { KeyRound, FileCheck, Users } from "lucide-react";

import { PermissionsTabCustomRoles } from "@/components/permissions/v2/tab-custom-roles";
import { PermissionsTabAudit } from "@/components/permissions/v2/tab-audit";

type TabKey = "custom-roles" | "audit";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  // 6.6up · 「角色模板」（内置角色默认包）已并入「角色管理」（= 内置角色 + 自定义角色）
  { key: "custom-roles", label: "角色管理", icon: <Users size={14} /> },
  { key: "audit", label: "权限审计", icon: <FileCheck size={14} /> },
];

function parseTab(value: string | null): TabKey {
  if (value === "custom-roles" || value === "audit") {
    return value;
  }
  // 6.6up · 旧 ?tab=personal / ?tab=templates 书签回落到默认「角色管理」
  return "custom-roles";
}

export default function PermissionsAdminPage() {
  // Next.js 16 要求 useSearchParams 必须在 Suspense boundary 内（预渲染 bailout 规则）
  return (
    <Suspense fallback={<AdminLayout><PageHeader icon={<KeyRound size={20} />} title="权限管理" /></AdminLayout>}>
      <PermissionsAdminPageInner />
    </Suspense>
  );
}

function PermissionsAdminPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { me, status: sessionStatus } = useAdminSession();
  // tab 直接由 ?tab= 派生（不存本地 state，避免与 URL 双源头同步）；浏览器后退 → 重渲
  const tab: TabKey = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const [adminKeys, setAdminKeys] = useState<readonly string[]>([]);
  const role = me?.role ?? me?.builtinRole ?? null;
  const permissionGuard: "loading" | "ok" | "denied" =
    sessionStatus === "loading" ? "loading" : role === "super_admin" ? "ok" : "denied";

  // ── 页面级 super_admin guard ────────────────────────────────
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!role) {
      router.replace("/admin");
      return;
    }
    if (role !== "super_admin") {
      router.replace("/admin/dashboard");
    }
  }, [role, router, sessionStatus]);

  // ── 拉 ADMIN keys 全集（Tab 1 / 2 矩阵用） ─────────────────
  useEffect(() => {
    if (permissionGuard !== "ok") return;
    fetch("/api/admin/permission-keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        // permission-keys API 返回 describeKey() 对象数组；Tab 1 / 2 矩阵只需要原始 key 字符串。
        if (Array.isArray(d.admin)) setAdminKeys(d.admin.map((x: { key: string }) => x.key));
      })
      .catch(() => {});
  }, [permissionGuard]);

  // ── 切 Tab：只动 URL；tab 由 useMemo 派生 ────────────────────
  const setTabAndUrl = useCallback(
    (next: TabKey) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", next);
      router.replace(`/admin/permissions?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const body = useMemo(() => {
    if (permissionGuard !== "ok") return null;
    switch (tab) {
      case "custom-roles":
        return <PermissionsTabCustomRoles adminKeys={adminKeys} />;
      case "audit":
        return <PermissionsTabAudit />;
    }
  }, [tab, adminKeys, permissionGuard]);

  return (
    <AdminLayout>
      <PageHeader
        icon={<KeyRound size={20} />}
        title="权限管理"
      />

      {/* Tab Bar */}
      <div className="mt-4 border-b border-gray-200">
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTabAndUrl(t.key)}
                className={
                  "flex items-center gap-1.5 px-4 py-2.5 text-[13px] border-b-2 -mb-px transition-colors " +
                  (active
                    ? "border-[#002FA7] text-[#002FA7] font-medium"
                    : "border-transparent text-gray-600 hover:text-gray-900")
                }
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {permissionGuard === "loading" && (
        <p className="text-[13px] text-gray-400 text-center py-12">加载中…</p>
      )}
      {permissionGuard === "denied" && (
        <p className="text-[13px] text-rose-600 text-center py-12">仅超级管理员可访问</p>
      )}
      {body}
    </AdminLayout>
  );
}
