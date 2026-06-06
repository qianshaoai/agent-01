"use client";
/**
 * 6.4up v2 Phase B · Tab 4 · 权限审计
 *
 * 拉 audit_logs WHERE resource_type IN ('builtin_role_permission','admin_override','custom_role')
 * 仅 super_admin 可见（C1 约束；服务端已强制）
 *
 * 形态：只读列表 + 简单 filter（type / date / pagination）+ 点行展开 detail JSON
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ChevronDown, ChevronUp, Filter, RefreshCw } from "lucide-react";

type AuditRow = {
  id: string;
  created_at: string;
  admin_id: string | null;
  admin_username: string | null;
  admin_role: string | null;
  admin_tenant_code: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  resource_tenant_code: string | null;
  detail: unknown;
};

const TYPE_LABEL: Record<string, string> = {
  builtin_role_permission: "角色默认包",
  admin_override: "个人 override",
  custom_role: "自定义角色",
};

const TYPE_CHIP: Record<string, string> = {
  builtin_role_permission: "bg-amber-50 text-amber-700 border-amber-200",
  admin_override: "bg-emerald-50 text-emerald-700 border-emerald-200",
  custom_role: "bg-violet-50 text-violet-700 border-violet-200",
};

export function PermissionsTabAudit() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [loading, setLoading] = useState(false);

  const [resourceType, setResourceType] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set("page", String(page));
      sp.set("pageSize", String(pageSize));
      if (resourceType) sp.set("resourceType", resourceType);
      if (dateFrom) sp.set("dateFrom", dateFrom);
      if (dateTo) sp.set("dateTo", dateTo);

      const r = await fetch(`/api/admin/permission-audit?${sp.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast(e?.error ?? "加载审计失败", "error");
        return;
      }
      const d = await r.json();
      setRows((d.data ?? []) as AuditRow[]);
      setTotal(d.pagination?.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, resourceType, dateFrom, dateTo, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Filter */}
      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter size={14} className="text-gray-400" />
          <span className="text-[12px] text-gray-500">筛选：</span>

          <select
            value={resourceType}
            onChange={(e) => {
              setResourceType(e.target.value);
              setPage(1);
            }}
            className="h-8 text-[12px] border border-gray-200 rounded-md px-2 bg-white"
          >
            <option value="">全部类型</option>
            <option value="builtin_role_permission">角色默认包</option>
            <option value="admin_override">个人 override</option>
            <option value="custom_role">自定义角色</option>
          </select>

          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="h-8 text-[12px] w-[140px]"
          />
          <span className="text-[12px] text-gray-400">至</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="h-8 text-[12px] w-[140px]"
          />

          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={12} className={"mr-1 " + (loading ? "animate-spin" : "")} />
            刷新
          </Button>

          <span className="ml-auto text-[12px] text-gray-500">
            共 <b className="text-gray-800">{total}</b> 条
          </span>
        </div>
      </Card>

      {/* 列表 */}
      <Card className="p-0">
        {loading && rows.length === 0 ? (
          <p className="text-[12px] text-gray-400 text-center py-12">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-gray-400 text-center py-12">无审计记录</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const isExp = expanded.has(r.id);
              return (
                <li key={r.id} className="px-4 py-2.5">
                  <button
                    onClick={() => toggleExpand(r.id)}
                    className="w-full text-left flex items-center gap-3"
                  >
                    {isExp ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    <span
                      className={
                        "text-[11px] px-1.5 py-0.5 rounded border " +
                        (TYPE_CHIP[r.resource_type] ?? "bg-gray-50 text-gray-600 border-gray-200")
                      }
                    >
                      {TYPE_LABEL[r.resource_type] ?? r.resource_type}
                    </span>
                    <span className="text-[11px] text-gray-500 font-mono">{r.action}</span>
                    <span className="text-[12px] text-gray-700 truncate flex-1 min-w-0">
                      {r.admin_username ?? r.admin_id ?? "(系统)"} ·{" "}
                      <code className="text-[11px] text-gray-500">
                        {r.resource_name ?? r.resource_id ?? ""}
                      </code>
                    </span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </button>
                  {isExp && (
                    <pre className="ml-7 mt-2 p-3 bg-gray-50 border border-gray-200 rounded-[8px] text-[11px] text-gray-700 overflow-x-auto font-mono">
                      {JSON.stringify(r.detail, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 分页 */}
      {total > pageSize && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-[12px] text-gray-500">
            第 {page} / {Math.ceil(total / pageSize)} 页
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page * pageSize >= total || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
