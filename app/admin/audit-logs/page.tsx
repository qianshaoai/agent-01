"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ClipboardList, Bot, GitBranch, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronLeft, ChevronRight, Building2, Users, Megaphone, Settings, Layers, UsersRound, Shield, ListTree, User, Loader2 } from "lucide-react";

type AuditLog = {
  id: string;
  admin_username: string;
  admin_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  create:  "新增",
  update:  "修改",
  delete:  "删除",
  enable:  "启用",
  disable: "禁用",
};

const ACTION_COLOR: Record<string, string> = {
  create:  "bg-green-50 text-green-700",
  update:  "bg-blue-50 text-blue-700",
  delete:  "bg-red-50 text-red-700",
  enable:  "bg-emerald-50 text-emerald-700",
  disable: "bg-gray-100 text-gray-600",
};

const ACTION_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  create:  Plus,
  update:  Pencil,
  delete:  Trash2,
  enable:  ToggleRight,
  disable: ToggleLeft,
};

const ROLE_LABEL: Record<string, string> = {
  super_admin:  "超级管理员",
  system_admin: "系统管理员",
  org_admin:    "组织管理员",
};

const RESOURCE_LABEL: Record<string, string> = {
  agent:               "智能体",
  workflow:            "工作流",
  workflow_step:       "工作流步骤",
  category:            "智能体分类",
  wf_category:         "工作流分类",
  notice:              "公告",
  tenant:              "组织",
  user:                "用户",
  department:          "部门",
  team:                "小组",
  user_group:          "用户分组",
  settings:            "系统设置",
  resource_permission: "访问权限",
};

function ResourceIcon({ type }: { type: string }) {
  const props = { size: 13 };
  switch (type) {
    case "agent":               return <Bot {...props} className="text-purple-500" />;
    case "workflow":            return <GitBranch {...props} className="text-blue-500" />;
    case "workflow_step":       return <ListTree {...props} className="text-blue-400" />;
    case "category":            return <Layers {...props} className="text-indigo-400" />;
    case "wf_category":         return <Layers {...props} className="text-cyan-500" />;
    case "notice":              return <Megaphone {...props} className="text-amber-500" />;
    case "tenant":              return <Building2 {...props} className="text-teal-500" />;
    case "user":                return <User {...props} className="text-sky-500" />;
    case "department":          return <Users {...props} className="text-green-500" />;
    case "team":                return <UsersRound {...props} className="text-lime-500" />;
    case "user_group":          return <UsersRound {...props} className="text-orange-400" />;
    case "settings":            return <Settings {...props} className="text-gray-500" />;
    case "resource_permission": return <Shield {...props} className="text-rose-400" />;
    default:                    return <Pencil {...props} className="text-gray-400" />;
  }
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [resourceType, setResourceType] = useState("all");
  const [action, setAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading spinner intentionally re-fires when filter/page deps change
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (resourceType !== "all") params.set("resourceType", resourceType);
    if (action !== "all")       params.set("action", action);
    if (dateFrom)               params.set("dateFrom", dateFrom);
    if (dateTo)                 params.set("dateTo", dateTo);

    fetch(`/api/admin/audit-logs?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setLogs(d.data ?? []);
        setTotal(d.pagination?.total ?? 0);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [page, resourceType, action, dateFrom, dateTo]);

  function handleFilterChange() {
    if (page !== 1) setPage(1);
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<ClipboardList size={20} />}
          title="审计记录"
          subtitle="记录所有管理员后台操作：组织、用户、智能体、工作流、公告、设置等"
        />

        {/* 筛选栏 */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">资源类型</label>
              <select
                value={resourceType}
                onChange={(e) => { setResourceType(e.target.value); handleFilterChange(); }}
                className="text-sm border border-gray-200 rounded-[8px] px-3 py-1.5 bg-white"
              >
                <option value="all">全部</option>
                <option value="agent">智能体</option>
                <option value="workflow">工作流</option>
                <option value="workflow_step">工作流步骤</option>
                <option value="tenant">组织</option>
                <option value="user">用户</option>
                <option value="category">智能体分类</option>
                <option value="wf_category">工作流分类</option>
                <option value="notice">公告</option>
                <option value="department">部门</option>
                <option value="team">小组</option>
                <option value="user_group">用户分组</option>
                <option value="settings">系统设置</option>
                <option value="resource_permission">访问权限</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">操作类型</label>
              <select
                value={action}
                onChange={(e) => { setAction(e.target.value); handleFilterChange(); }}
                className="text-sm border border-gray-200 rounded-[8px] px-3 py-1.5 bg-white"
              >
                <option value="all">全部</option>
                <option value="create">新增</option>
                <option value="update">修改</option>
                <option value="delete">删除</option>
                <option value="enable">启用</option>
                <option value="disable">禁用</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">开始日期</label>
              <input
                type="date"
                lang="zh-CN"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); handleFilterChange(); }}
                className="text-sm border border-gray-200 rounded-[8px] px-3 py-1.5 bg-white"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">结束日期</label>
              <input
                type="date"
                lang="zh-CN"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); handleFilterChange(); }}
                className="text-sm border border-gray-200 rounded-[8px] px-3 py-1.5 bg-white"
              />
            </div>
            {(resourceType !== "all" || action !== "all" || dateFrom || dateTo) && (
              <button
                onClick={() => { setResourceType("all"); setAction("all"); setDateFrom(""); setDateTo(""); setPage(1); }}
                className="text-xs text-gray-400 hover:text-gray-600 py-1.5"
              >
                清除筛选
              </button>
            )}
            <span className="ml-auto text-sm text-gray-400 py-1.5">共 {total} 条记录</span>
          </div>
        </Card>

        {/* 表格 */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Loader2 size={28} className="animate-spin text-[#002FA7]/60 mb-3" />
              <p className="text-sm">加载审计记录中…</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <ClipboardList size={32} className="mb-3 opacity-30" />
              <p className="text-sm">暂无审计记录</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-xs text-gray-500">
                  <th className="text-left px-4 py-3 font-medium">时间</th>
                  <th className="text-left px-4 py-3 font-medium">操作人</th>
                  <th className="text-left px-4 py-3 font-medium">操作</th>
                  <th className="text-left px-4 py-3 font-medium">资源类型</th>
                  <th className="text-left px-4 py-3 font-medium">资源名称</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => {
                  const ActionIcon = ACTION_ICON[log.action] ?? Pencil;
                  return (
                    <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap tabular-nums text-xs">
                        {new Date(log.created_at).toLocaleString("zh-CN", {
                          year: "numeric", month: "2-digit", day: "2-digit",
                          hour: "2-digit", minute: "2-digit", second: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-700">{log.admin_username}</span>
                        <span className="ml-1.5 text-xs text-gray-400">
                          {ROLE_LABEL[log.admin_role] ?? log.admin_role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLOR[log.action] ?? "bg-gray-100 text-gray-600"}`}>
                          <ActionIcon size={11} />
                          {ACTION_LABEL[log.action] ?? log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-gray-600">
                          <ResourceIcon type={log.resource_type} />
                          {RESOURCE_LABEL[log.resource_type] ?? log.resource_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {log.resource_name ?? <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
