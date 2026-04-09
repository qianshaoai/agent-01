"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Building2, Bot, Megaphone, BarChart3, FileText, Users, TrendingUp, AlertCircle } from "lucide-react";

type Analytics = {
  totalCalls: number;
  successRate: number;
  totalTenants: number;
  topAgents: { id: string; name: string; calls: number }[];
  tenantUsage: { code: string; name: string; used: number; quota: number }[];
};

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [noticeCount, setNoticeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/analytics").then((r) => r.json()),
      fetch("/api/admin/agents").then((r) => r.json()),
      fetch("/api/admin/notices").then((r) => r.json()),
    ]).then(([analytics, agents, notices]) => {
      setData(analytics);
      setAgentCount(Array.isArray(agents) ? agents.length : 0);
      setNoticeCount(Array.isArray(notices) ? notices.length : 0);
    }).finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: "组织码管理", desc: "新增/编辑/禁用组织码，配置额度与到期", icon: Building2, href: "/admin/tenants", count: data?.totalTenants ?? "—", countLabel: "家组织", color: "bg-blue-50 text-blue-600" },
    { label: "智能体管理", desc: "管理分类与智能体，配置 API 对接", icon: Bot, href: "/admin/agents", count: agentCount || "—", countLabel: "个智能体", color: "bg-purple-50 text-purple-600" },
    { label: "公告管理", desc: "配置全局公告与组织专属公告", icon: Megaphone, href: "/admin/notices", count: noticeCount || "—", countLabel: "条公告", color: "bg-amber-50 text-amber-600" },
    { label: "用量看板", desc: "组织用量统计与 Top 智能体分析", icon: BarChart3, href: "/admin/analytics", count: data?.totalCalls ?? "—", countLabel: "总调用次数", color: "bg-green-50 text-green-600" },
    { label: "操作日志", desc: "登录、调用、失败等全量日志查询", icon: FileText, href: "/admin/logs", count: "实时", countLabel: "审计日志", color: "bg-gray-50 text-gray-600" },
  ];

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">控制台</h1>
          <p className="text-sm text-gray-500 mt-0.5">欢迎回到 AI 智能体平台管理后台</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "活跃组织", value: data?.totalTenants, icon: Users, color: "text-[#002FA7] bg-[#f0f4ff]" },
            { label: "智能体数量", value: agentCount, icon: Bot, color: "text-purple-600 bg-purple-50" },
            { label: "总调用次数", value: data?.totalCalls?.toLocaleString(), icon: TrendingUp, color: "text-green-600 bg-green-50" },
            { label: "调用成功率", value: data ? `${data.successRate}%` : "—", icon: AlertCircle, color: "text-amber-600 bg-amber-50" },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center mb-3 ${stat.color}`}>
                <stat.icon size={18} />
              </div>
              {loading ? (
                <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mb-1" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">{stat.value ?? "—"}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Nav cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <Link key={card.href} href={card.href} className="group bg-white rounded-[16px] p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,47,167,0.10)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center ${card.color}`}>
                  <card.icon size={22} />
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-gray-900">{card.count}</p>
                  <p className="text-xs text-gray-400">{card.countLabel}</p>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-[#002FA7] transition-colors">{card.label}</h3>
                <p className="text-xs text-gray-500">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Quota overview */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">组织配额概览</h2>
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-[10px] animate-pulse" />)}
            </div>
          ) : data?.tenantUsage.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">暂无组织数据</p>
          ) : (
            <div className="space-y-3">
              {data?.tenantUsage.map((t) => {
                const pct = Math.round((t.used / t.quota) * 100);
                return (
                  <div key={t.code} className="flex items-center gap-3">
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{t.code}</p>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#002FA7]"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                    <span className={`text-xs font-medium w-20 text-right shrink-0 ${pct >= 100 ? "text-red-500" : "text-gray-600"}`}>
                      {t.used}/{t.quota} 次
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
