"use client";
import { useEffect, useState, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { TrendingUp, Bot, Building2, AlertCircle, RefreshCw, BarChart3, Users, Search, X } from "lucide-react";

type UserUsage = {
  userId: string | null;
  phone: string;
  tenantCode: string | null;
  realName: string | null;
  username: string | null;
  deptId: string | null;
  teamId: string | null;
  deptName: string | null;
  teamName: string | null;
  calls: number;
  lastUsed: string;
  topAgent: { code: string; name: string; calls: number } | null;
};

type Analytics = {
  totalCalls: number;
  successCalls: number;
  successRate: number;
  totalTenants: number;
  topAgents: { id: string; name: string; calls: number }[];
  tenantUsage: { code: string; name: string; used: number; quota: number }[];
  userUsage: UserUsage[];
};

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "users">("overview");

  // 筛选
  const [tenants, setTenants] = useState<{ code: string; name: string }[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string; tenant_code: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; dept_id: string }[]>([]);
  const [tenantFilter, setTenantFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ days: String(days) });
    if (tenantFilter) params.set("tenantCode", tenantFilter);
    if (deptFilter) params.set("deptId", deptFilter);
    if (teamFilter) params.set("teamId", teamFilter);
    if (userSearch) params.set("userSearch", userSearch);
    const res = await fetch(`/api/admin/analytics?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [days, tenantFilter, deptFilter, teamFilter, userSearch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/tenants").then(r => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/admin/departments").then(r => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/admin/teams").then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([t, d, tm]) => {
      setTenants(Array.isArray(t) ? t : []);
      setDepts(Array.isArray(d) ? d : []);
      setTeams(Array.isArray(tm) ? tm : []);
    });
  }, []);

  const stats = [
    { label: "总调用次数", value: data?.totalCalls?.toLocaleString() ?? "—", icon: TrendingUp, color: "text-[#002FA7] bg-[#002FA7]/8" },
    { label: "接入组织数", value: data?.totalTenants ?? "—", icon: Building2, color: "text-blue-600 bg-blue-50" },
    { label: "成功次数", value: data?.successCalls?.toLocaleString() ?? "—", icon: Bot, color: "text-purple-600 bg-purple-50" },
    { label: "调用成功率", value: data ? `${data.successRate}%` : "—", icon: AlertCircle, color: "text-green-600 bg-green-50" },
  ];

  const filteredDepts = tenantFilter ? depts.filter(d => d.tenant_code === tenantFilter) : depts;
  const filteredTeams = deptFilter ? teams.filter(t => t.dept_id === deptFilter) : teams;

  function fmtDate(s: string) {
    return new Date(s).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  const hasFilter = tenantFilter || deptFilter || teamFilter || userSearch;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<BarChart3 size={20} />}
          title="用量看板"
          subtitle="组织维度 + 个人维度调用统计（实时）"
          actions={
            <>
              <div className="flex gap-1 p-1 bg-gray-100/70 rounded-[10px]">
                {(["overview", "users"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    {tab === "overview" ? "概览" : "用户维度"}
                  </button>
                ))}
              </div>
              <select className="h-9 px-3 border border-gray-200 rounded-[10px] text-[13px] bg-white focus:outline-none focus:border-[#002FA7]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>近 7 天</option>
                <option value={30}>近 30 天</option>
                <option value={90}>近 90 天</option>
                <option value={0}>全部</option>
              </select>
              <button onClick={load} className="flex items-center gap-1.5 px-3 h-9 rounded-[10px] text-[13px] text-gray-500 hover:bg-gray-100 transition-colors">
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 刷新
              </button>
            </>
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

        {activeTab === "overview" && (
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
        )}

        {activeTab === "users" && (
          <>
            {/* 筛选栏 */}
            <Card padding="md" className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
                  placeholder="搜索手机号 / 用户名 / 真实姓名…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                />
              </div>
              <select className="h-10 px-3 text-sm bg-white border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7]" value={tenantFilter} onChange={(e) => { setTenantFilter(e.target.value); setDeptFilter(""); setTeamFilter(""); }}>
                <option value="">全部组织</option>
                {tenants.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
              <select className="h-10 px-3 text-sm bg-white border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7]" value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setTeamFilter(""); }}>
                <option value="">全部部门</option>
                {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select className="h-10 px-3 text-sm bg-white border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7]" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="">全部小组</option>
                {filteredTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {hasFilter && (
                <button onClick={() => { setTenantFilter(""); setDeptFilter(""); setTeamFilter(""); setUserSearch(""); }} className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2">
                  <X size={13} /> 清除
                </button>
              )}
            </Card>

            {/* 用户列表 */}
            <Card padding="none" className="overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                  <Users size={17} className="text-[#002FA7]" /> 用户调用明细
                </h2>
                <span className="text-[12px] text-gray-500">共 {data?.userUsage?.length ?? 0} 人</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-sticky-head">
                  <thead>
                    <tr>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">用户</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">手机号</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">组织</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">部门 / 小组</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">调用次数</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">常用智能体</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">最近使用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          {[...Array(7)].map((_, j) => (
                            <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                          ))}
                        </tr>
                      ))
                    ) : !data?.userUsage || data.userUsage.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-14 text-center text-sm text-gray-400">暂无调用数据</td>
                      </tr>
                    ) : (
                      data.userUsage.map((u, idx) => (
                        <tr key={u.userId || u.phone || idx} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-4">
                            <p className="font-medium text-gray-800">{u.realName || u.username || "—"}</p>
                            {u.username && <p className="text-[11px] text-gray-400">@{u.username}</p>}
                          </td>
                          <td className="px-5 py-4 text-gray-600 font-mono text-[13px]">{u.phone}</td>
                          <td className="px-5 py-4">
                            <span className="text-gray-700 text-[13px]">{tenants.find(t => t.code === u.tenantCode)?.name ?? u.tenantCode ?? "个人"}</span>
                          </td>
                          <td className="px-5 py-4 text-[13px] text-gray-500">
                            {u.deptName ? <span>{u.deptName}{u.teamName ? <span className="text-gray-400"> / {u.teamName}</span> : null}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#002FA7]/8 text-[#002FA7]">{u.calls.toLocaleString()}</span>
                          </td>
                          <td className="px-5 py-4 text-[13px] text-gray-600">
                            {u.topAgent ? <span>{u.topAgent.name}<span className="text-gray-400 ml-1">×{u.topAgent.calls}</span></span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-4 text-[12px] text-gray-500">{fmtDate(u.lastUsed)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
