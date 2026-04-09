"use client";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { TrendingUp, Bot, Building2, AlertCircle, RefreshCw } from "lucide-react";

type Analytics = {
  totalCalls: number;
  successCalls: number;
  successRate: number;
  totalTenants: number;
  topAgents: { id: string; name: string; calls: number }[];
  tenantUsage: { code: string; name: string; used: number; quota: number }[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/analytics");
    if (res.ok) setData(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const stats = [
    { label: "总调用次数", value: data?.totalCalls?.toLocaleString() ?? "—", icon: TrendingUp, color: "text-[#002FA7] bg-[#f0f4ff]" },
    { label: "接入组织数", value: data?.totalTenants ?? "—", icon: Building2, color: "text-blue-600 bg-blue-50" },
    { label: "成功次数", value: data?.successCalls?.toLocaleString() ?? "—", icon: Bot, color: "text-purple-600 bg-purple-50" },
    { label: "调用成功率", value: data ? `${data.successRate}%` : "—", icon: AlertCircle, color: "text-green-600 bg-green-50" },
  ];

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold text-gray-900">用量看板</h1><p className="text-sm text-gray-500 mt-0.5">组织维度调用统计（实时）</p></div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#002FA7] transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 刷新
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center mb-3 ${stat.color}`}><stat.icon size={18} /></div>
              {loading ? <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mb-1" /> : <p className="text-2xl font-bold text-gray-900">{stat.value}</p>}
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
            <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><Bot size={16} className="text-[#002FA7]" /> Top 智能体</h2>
            {loading ? (
              <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />)}</div>
            ) : !data?.topAgents.length ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无调用记录</p>
            ) : (
              <div className="space-y-3">
                {data.topAgents.map((agent, idx) => {
                  const maxCalls = data.topAgents[0].calls;
                  const pct = Math.round((agent.calls / maxCalls) * 100);
                  return (
                    <div key={agent.id} className="flex items-center gap-3">
                      <span className={`w-5 text-xs font-bold shrink-0 ${idx === 0 ? "text-amber-500" : "text-gray-400"}`}>{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1"><span className="text-sm text-gray-700 truncate">{agent.name}</span><span className="text-xs text-gray-500 ml-2 shrink-0">{agent.calls.toLocaleString()} 次</span></div>
                        <div className="h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-[#002FA7] rounded-full" style={{ width: `${pct}%` }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
            <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2"><Building2 size={16} className="text-[#002FA7]" /> 组织使用情况</h2>
            {loading ? (
              <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />)}</div>
            ) : !data?.tenantUsage.length ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无组织数据</p>
            ) : (
              <div className="space-y-4">
                {data.tenantUsage.map((t) => {
                  const pct = Math.round((t.used / t.quota) * 100);
                  return (
                    <div key={t.code}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div><span className="text-sm font-medium text-gray-800">{t.name}</span><code className="ml-2 text-xs text-gray-400 font-mono">{t.code}</code></div>
                        <span className={`text-xs font-medium ${pct >= 100 ? "text-red-500" : "text-gray-600"}`}>{t.used}/{t.quota}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#002FA7]"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-400">已用 {pct}%</span>
                        <span className={`text-[10px] font-medium ${pct >= 100 ? "text-red-500" : pct >= 80 ? "text-amber-500" : "text-green-600"}`}>{pct >= 100 ? "额度已耗尽" : pct >= 80 ? "即将耗尽" : "正常"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
