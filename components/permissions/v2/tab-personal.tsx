"use client";
/**
 * 6.4up v2 Phase B · Tab 1 · 管理员个人权限
 *
 * 左：admin 列表（来自 /api/admin/builtin-admins，含 overrideCount）
 * 右：选中 admin 详情（来自 /api/admin/admin-effective/[adminId]?source=...）
 *      - 矩阵交互式：点击 chip toggle override
 *      - super_admin 行只读 + 提示"硬全权"
 *      - 个人 override 不弹二次确认（D3 拍板）
 *
 * D1 约束：列表 lazy load，详情进面板时才算 effective
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Search, UserCircle2, Shield } from "lucide-react";
import {
  PermissionMatrix,
  CellState,
  splitKey,
} from "./permission-matrix";

type AdminSource = "admin_table" | "user_admin";

type AdminRow = {
  id: string;
  source: AdminSource;
  username: string;
  role: "super_admin" | "system_admin" | "org_admin";
  tenantCode: string | null;
  overrideCount: number;
};

type EffectivePayload = {
  role: "super_admin" | "system_admin" | "org_admin";
  defaultPackKeys: string[];
  overrides: Array<{
    permission_key: string;
    effect: "grant" | "revoke";
    reason: string | null;
    created_by: string;
    created_at: string;
  }>;
  effective: string[];
  superAdmin: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "超级管理员",
  system_admin: "系统管理员",
  org_admin: "组织管理员",
};

const ROLE_CHIP: Record<string, string> = {
  super_admin: "bg-amber-50 text-amber-700 border-amber-200",
  system_admin: "bg-violet-50 text-violet-700 border-violet-200",
  org_admin: "bg-sky-50 text-sky-700 border-sky-200",
};

export function PermissionsTabPersonal(props: { adminKeys: readonly string[] }) {
  const { adminKeys } = props;
  const { toast } = useToast();

  const [list, setList] = useState<AdminRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminRow | null>(null);
  const [detail, setDetail] = useState<EffectivePayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // ── 拉列表 ───────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/admin/builtin-admins", { cache: "no-store" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast(e?.error ?? "加载管理员列表失败", "error");
        return;
      }
      const d = await r.json();
      setList((d.data ?? []) as AdminRow[]);
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // ── 选中后 lazy load effective（D1）─────────────────────────
  const loadDetail = useCallback(
    async (row: AdminRow) => {
      setLoadingDetail(true);
      try {
        const r = await fetch(
          `/api/admin/admin-effective/${row.id}?source=${row.source}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          toast(e?.error ?? "加载权限详情失败", "error");
          setDetail(null);
          return;
        }
        const d = (await r.json()) as EffectivePayload;
        setDetail(d);
      } finally {
        setLoadingDetail(false);
      }
    },
    [toast],
  );

  function handleSelect(row: AdminRow) {
    setSelected(row);
    setDetail(null);
    void loadDetail(row);
  }

  // ── 过滤 ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const k = search.trim().toLowerCase();
    if (!k) return list;
    return list.filter(
      (r) =>
        r.username.toLowerCase().includes(k) ||
        (r.tenantCode ?? "").toLowerCase().includes(k) ||
        (ROLE_LABEL[r.role] ?? "").toLowerCase().includes(k),
    );
  }, [list, search]);

  // ── cell state resolver（详情用）─────────────────────────────
  const cellState = useMemo<(k: string) => CellState>(() => {
    if (!detail) return () => "off";
    const defaultSet = new Set(detail.defaultPackKeys);
    const grantSet = new Set(
      detail.overrides.filter((o) => o.effect === "grant").map((o) => o.permission_key),
    );
    const revokeSet = new Set(
      detail.overrides.filter((o) => o.effect === "revoke").map((o) => o.permission_key),
    );
    return (k) => {
      if (revokeSet.has(k)) return "revoke";
      if (grantSet.has(k)) return "grant";
      if (defaultSet.has(k)) return "default";
      return "off";
    };
  }, [detail]);

  // ── toggle cell（不弹二次确认；个人粒度，1 人影响）──────────
  async function toggleKey(key: string, nextOn: boolean) {
    if (!selected || !detail || detail.superAdmin) return;
    // 规则：
    //  默认包持有 (default) + 想 nextOn=false → 加 revoke override
    //  默认包不持有 (off) + 想 nextOn=true → 加 grant override
    //  已有 grant + 想 nextOn=false → DELETE override（回到 off / default 取决于默认包）
    //  已有 revoke + 想 nextOn=true → DELETE override（回到 default）
    const state = cellState(key);
    let plan: "grant" | "revoke" | "delete";
    if (state === "grant" && !nextOn) plan = "delete";
    else if (state === "revoke" && nextOn) plan = "delete";
    else if (state === "default" && !nextOn) plan = "revoke";
    else if (state === "off" && nextOn) plan = "grant";
    else return; // 无操作

    setPendingKey(key);
    try {
      if (plan === "delete") {
        const r = await fetch(
          `/api/admin/admin-overrides/${selected.id}?source=${selected.source}&key=${encodeURIComponent(key)}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          toast(e?.error ?? "清除 override 失败", "error");
          return;
        }
      } else {
        const r = await fetch("/api/admin/admin-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminId: selected.id,
            adminSource: selected.source,
            permissionKey: key,
            effect: plan,
          }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          toast(e?.error ?? "写入 override 失败", "error");
          return;
        }
      }
      await Promise.all([loadDetail(selected), loadList()]);
    } finally {
      setPendingKey(null);
    }
  }

  // ── render ───────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-[320px_1fr] gap-4 mt-4">
      {/* 左 · 列表 */}
      <Card className="p-3 flex flex-col h-[calc(100vh-260px)] min-h-[480px]">
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索：用户名 / 角色 / 组织"
            className="pl-9 h-9 text-[13px]"
          />
        </div>
        <div className="flex-1 overflow-y-auto -mx-1">
          {loadingList && (
            <p className="text-[12px] text-gray-400 text-center py-8">加载中…</p>
          )}
          {!loadingList && filtered.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-8">无匹配管理员</p>
          )}
          {!loadingList &&
            filtered.map((r) => {
              const active =
                selected && selected.id === r.id && selected.source === r.source;
              return (
                <button
                  key={`${r.source}:${r.id}`}
                  onClick={() => handleSelect(r)}
                  className={
                    "w-full text-left px-2.5 py-2 rounded-[8px] mb-1 border transition-colors " +
                    (active
                      ? "bg-[#002FA7]/8 border-[#002FA7]/30"
                      : "bg-white border-transparent hover:bg-gray-50 hover:border-gray-100")
                  }
                >
                  <div className="flex items-center gap-2">
                    {r.role === "super_admin" ? (
                      <Shield size={14} className="text-amber-500 shrink-0" />
                    ) : (
                      <UserCircle2 size={14} className="text-gray-400 shrink-0" />
                    )}
                    <span className="text-[13px] font-medium text-gray-800 truncate flex-1">
                      {r.username}
                    </span>
                    {r.overrideCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {r.overrideCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span
                      className={
                        "text-[10px] px-1.5 py-0.5 rounded border " + ROLE_CHIP[r.role]
                      }
                    >
                      {ROLE_LABEL[r.role]}
                    </span>
                    {r.tenantCode && (
                      <span className="text-[10px] text-gray-400 font-mono">
                        {r.tenantCode}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300 ml-auto">
                      {r.source === "admin_table" ? "admin" : "user_admin"}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>
      </Card>

      {/* 右 · 详情 */}
      <Card className="p-5 overflow-y-auto h-[calc(100vh-260px)] min-h-[480px]">
        {!selected && (
          <p className="text-[13px] text-gray-400 text-center py-12">
            从左侧选择一个管理员查看个人 effective 权限
          </p>
        )}
        {selected && (
          <>
            <div className="mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-[15px] font-semibold text-gray-900">
                  {selected.username}
                </h3>
                <span
                  className={
                    "text-[11px] px-2 py-0.5 rounded border " + ROLE_CHIP[selected.role]
                  }
                >
                  {ROLE_LABEL[selected.role]}
                </span>
                {selected.tenantCode && (
                  <code className="text-[11px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                    {selected.tenantCode}
                  </code>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">
                  {selected.source === "admin_table" ? "admins 表" : "user_admin（users.role 提升）"}
                </span>
              </div>
              {detail && !detail.superAdmin && (
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500">
                  <span>
                    默认包：<b className="text-gray-800">{detail.defaultPackKeys.length}</b> keys
                  </span>
                  <span>
                    grant override：
                    <b className="text-emerald-700">
                      {detail.overrides.filter((o) => o.effect === "grant").length}
                    </b>
                  </span>
                  <span>
                    revoke override：
                    <b className="text-rose-600">
                      {detail.overrides.filter((o) => o.effect === "revoke").length}
                    </b>
                  </span>
                  <span>
                    最终生效：<b className="text-[#002FA7]">{detail.effective.length}</b> keys
                  </span>
                </div>
              )}
              {pendingKey && (
                <p className="mt-2 text-[11px] text-gray-400">
                  正在写入 {pendingKey}…
                </p>
              )}
            </div>

            {loadingDetail && (
              <p className="text-[12px] text-gray-400 py-8 text-center">加载详情中…</p>
            )}

            {!loadingDetail && detail?.superAdmin && (
              <div className="rounded-[10px] bg-amber-50 border border-amber-200 p-4 flex items-center gap-2">
                <Shield size={16} className="text-amber-600 shrink-0" />
                <p className="text-[13px] text-amber-800">
                  超级管理员 <b>硬全权</b>，由公式第 1 行覆盖，不参与 v2 默认包 / override 体系，
                  不允许编辑。
                </p>
              </div>
            )}

            {!loadingDetail && detail && !detail.superAdmin && (
              <PermissionMatrix
                allKeys={visibleKeysForRole(adminKeys, detail.role)}
                resolveCellState={cellState}
                editable={true}
                onToggle={toggleKey}
              />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// 仅展示与该 role 相关的资源 keys：v52 表里 super 不入；非 super 的 role
// 在 ADMIN_PERMISSION_KEYS 中可被 override 的全集都展示（让 super 能任意 grant）
function visibleKeysForRole(allKeys: readonly string[], _role: string): string[] {
  void _role;
  return allKeys.filter((k) => {
    const p = splitKey(k);
    if (!p) return false;
    // 业务约束：setting.* / permission.* 不参与（admin-overrides POST 已拦）
    if (p.resource === "setting" || p.resource === "permission") return false;
    return true;
  });
}
