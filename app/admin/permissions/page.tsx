"use client";
/**
 * 6.4up v2 Phase B · 权限管理 4 Tab 容器
 *
 * 3 Tab（6.6up · 「个人权限」入口按用户验收意见隐藏；后端 admin-overrides/admin-effective/
 *   builtin-admins 接口与 admin_permission_overrides 表保留不动，仅去 UI 入口、可逆）：
 *   1. 角色模板（system_admin / org_admin 默认包 + 二次确认 + 双护栏）
 *   2. 自定义角色（搬 6.4up 原 page 内容；行为不变）
 *   3. 权限审计（audit_logs 三类资源筛选）
 *
 * URL 同步：?tab=templates|custom-roles|audit（默认 custom-roles）
 *   - 浏览器前进/后退保留状态
 *   - 深链分享
 *
 * 权限：super_admin only（页面级 fetch /api/admin/me 兜底 + 各 Tab API 服务端 super 强制）
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PageHeader } from "@/components/ui/page-header";
import { KeyRound, Shield, FileCheck, Users } from "lucide-react";

import { PermissionsTabTemplates } from "@/components/permissions/v2/tab-templates";
import { PermissionsTabCustomRoles } from "@/components/permissions/v2/tab-custom-roles";
import { PermissionsTabAudit } from "@/components/permissions/v2/tab-audit";

type TabKey = "templates" | "custom-roles" | "audit";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "templates", label: "角色模板", icon: <Shield size={14} /> },
  { key: "custom-roles", label: "自定义角色", icon: <Users size={14} /> },
  { key: "audit", label: "权限审计", icon: <FileCheck size={14} /> },
];

function parseTab(value: string | null): TabKey {
  if (value === "templates" || value === "custom-roles" || value === "audit") {
    return value;
  }
  // 6.6up · 「个人权限」tab 已隐藏；旧 ?tab=personal 书签回落到默认
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
  // tab 直接由 ?tab= 派生（不存本地 state，避免与 URL 双源头同步）；浏览器后退 → 重渲
  const tab: TabKey = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);
  const [adminKeys, setAdminKeys] = useState<readonly string[]>([]);
  const [permissionGuard, setPermissionGuard] = useState<"loading" | "ok" | "denied">(
    "loading",
  );

  // ── 页面级 super_admin guard ────────────────────────────────
  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me?.role) {
          router.replace("/admin");
          return;
        }
        if (me.role !== "super_admin") {
          setPermissionGuard("denied");
          router.replace("/admin/dashboard");
          return;
        }
        setPermissionGuard("ok");
      })
      .catch(() => router.replace("/admin"));
  }, [router]);

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
      case "templates":
        return <PermissionsTabTemplates adminKeys={adminKeys} />;
      case "custom-roles":
        return <PermissionsTabCustomRoles />;
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
