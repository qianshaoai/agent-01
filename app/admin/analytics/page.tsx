"use client";
import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { TrendingUp, Bot, Building2, AlertCircle, RefreshCw, BarChart3 } from "lucide-react";

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
    { label: "总调用次数", value: data?.totalCalls?.toLocaleString() ?? "—", icon: TrendingUp, color: "text-[#002FA7] bg-[#002FA7]/8" },
    { label: "接入组织数", value: data?.totalTenants ?? "—", icon: Building2, color: "text-blue-600 bg-blue-50" },
    { label: "成功次数", value: data?.successCalls?.toLocaleString() ?? "—", icon: Bot, color: "text-purple-600 bg-purple-50" },
    { label: "调用成功率", value: data ? `${data.successRate}%` : "—", icon: AlertCircle, color: "text-green-600 bg-green-50" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<BarChart3 size={20} />}
          title="用量看板"
          subtitle="组织维度调用统计（实时）"
          actions={
            <button onClick={load} className="flex items-center gap-1.5 px-3 h-9 rounded-[10px] text-[13px] text-gray-500 hover:bg-gray-100 transition-colors">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 刷新
            </button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label} padding="md">
              <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center mb-3 ${stat.color}`}><stat.icon size={19} /></div>
              {loading ? <div className="h-8 w-20 bg-gray-100 rounded animate-pulse mb-1" /> : <p className="text-[26px] font-semibold text-gray-900 leading-none">{stat.value}</p>}
              <p className="text-[12px] text-gray-500 mt-2">{stat.label}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card padding="lg">
            <h2 className="text-[15px] font-semibold text-gray-900 mb-5 flex items-center gap-2"><Bot size={17} className="text-[#002FA7]" /> Top 智能体</h2>
            {loading ? (
              <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded animate-pulse" />)}</div>
            ) : !data?.topAgents.length ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无调用记录</p>
            ) : (
              <div className="space-y-4">
                {data.topAgents.map((agent, idx) => {
                  const maxCalls = data.topAgents[0].calls;
                  const pct = Math.round((agent.calls / maxCalls) * 100);
                  return (
                    <div key={agent.id} className="flex items-center gap-3">
                      <span className={`w-6 text-[13px] font-bold shrink-0 ${idx === 0 ? "text-amber-500" : "text-gray-400"}`}>{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5"><span className="text-sm text-gray-700 truncate">{agent.name}</span><span className="text-[12px] text-gray-500 ml-2 shrink-0">{agent.calls.toLocaleString()} 次</span></div>
                        <div className="h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-[#002FA7] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card padding="lg">
            <h2 className="text-[15px] font-semibold text-gray-900 mb-5 flex items-center gap-2"><Building2 size={17} className="text-[#002FA7]" /> 组织使用情况</h2>
            {loading ? (
              <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded animate-pulse" />)}</div>
            ) : !data?.tenantUsage.length ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无组织数据</p>
            ) : (
              <div className="space-y-5">
                {data.tenantUsage.map((t) => {
                  const pct = Math.round((t.used / t.quota) * 100);
                  return (
                    <div key={t.code}>
                      <div className="flex items-center justify-between mb-2">
                        <div><span className="text-sm font-medium text-gray-800">{t.name}</span><code className="ml-2 text-[12px] text-gray-400 font-mono">{t.code}</code></div>
                        <span className={`text-[13px] font-medium ${pct >= 100 ? "text-red-500" : "text-gray-600"}`}>{t.used}/{t.quota}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#002FA7]"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[11px] text-gray-400">已用 {pct}%</span>
                        <span className={`text-[11px] font-medium ${pct >= 100 ? "text-red-500" : pct >= 80 ? "text-amber-500" : "text-green-600"}`}>{pct >= 100 ? "额度已耗尽" : pct >= 80 ? "即将耗尽" : "正常"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
