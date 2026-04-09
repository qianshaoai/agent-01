"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Badge } from "@/components/ui/badge";
import { Search, Filter, Clock, AlertCircle, CheckCircle2, LogIn, Upload, MessageSquare, RefreshCw } from "lucide-react";

type Log = {
  id: string;
  user_phone: string | null;
  tenant_code: string | null;
  agent_code: string | null;
  agent_name: string | null;
  action: string;
  status: "success" | "error";
  duration_ms: number | null;
  error_msg: string | null;
  created_at: string;
};
type Tenant = { code: string; name: string };

const ACTION_ICONS: Record<string, typeof MessageSquare> = { chat: MessageSquare, login: LogIn, upload: Upload };
const ACTION_LABELS: Record<string, string> = { chat: "对话", login: "登录", upload: "上传", speech: "语音" };

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (tenantFilter !== "all") params.set("tenantCode", tenantFilter);

    const [lr, tr] = await Promise.all([
      fetch(`/api/admin/logs?${params}`).then((r) => r.json()),
      fetch("/api/admin/tenants").then((r) => r.json()),
    ]);
    setLogs(Array.isArray(lr) ? lr : []);
    setTenants(Array.isArray(tr) ? tr : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [statusFilter, tenantFilter]);

  function handleSearch(e: React.FormEvent) { e.preventDefault(); load(); }

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold text-gray-900">操作日志</h1><p className="text-sm text-gray-500 mt-0.5">全量审计日志</p></div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#002FA7] transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 刷新
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="h-10 pl-9 pr-4 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 w-56" placeholder="手机号、组织码、智能体…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="h-10 px-3 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-[#002FA7]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
          </select>
          <select className="h-10 px-3 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-[#002FA7]" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
            <option value="all">全部组织</option>
            {tenants.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
          <button type="submit" className="h-10 px-4 bg-[#002FA7] text-white text-sm rounded-[10px] hover:bg-[#1a47c0] transition-colors">搜索</button>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 px-2"><Filter size={13} />共 {logs.length} 条</div>
        </form>

        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-[10px] animate-pulse" />)}</div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-gray-400"><MessageSquare size={32} className="mx-auto mb-3 text-gray-200" /><p className="text-sm">暂无日志记录</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {["时间", "用户", "智能体", "操作", "状态", "耗时"].map((h) => <th key={h} className="px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.map((log) => {
                    const ActionIcon = ACTION_ICONS[log.action] ?? MessageSquare;
                    return (
                      <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5"><Clock size={12} className="text-gray-300 shrink-0" /><span className="text-xs text-gray-500">{new Date(log.created_at).toLocaleString("zh-CN")}</span></div>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-gray-800">{log.user_phone ?? "—"}</p>
                          <code className="text-[10px] text-gray-400 font-mono">{log.tenant_code ?? "个人"}</code>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-gray-700">{log.agent_name ?? "—"}</p>
                          <code className="text-[10px] text-gray-400 font-mono">{log.agent_code ?? ""}</code>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5"><ActionIcon size={13} className="text-gray-400" /><span className="text-gray-600">{ACTION_LABELS[log.action] ?? log.action}</span></div>
                        </td>
                        <td className="px-5 py-3.5">
                          {log.status === "success" ? (
                            <div className="flex items-center gap-1 text-green-600"><CheckCircle2 size={13} /><span className="text-xs">成功</span></div>
                          ) : (
                            <div><div className="flex items-center gap-1 text-red-500"><AlertCircle size={13} /><span className="text-xs">失败</span></div>{log.error_msg && <p className="text-[10px] text-red-400 mt-0.5 max-w-[120px] truncate">{log.error_msg}</p>}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {log.duration_ms ? <span className="text-xs text-gray-500">{log.duration_ms}ms</span> : <span className="text-xs text-gray-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
