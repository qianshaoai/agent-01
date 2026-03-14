"use client";
import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Users, Search, RefreshCw, ShieldOff, ShieldCheck, KeyRound, X } from "lucide-react";

type UserRow = {
  id: string;
  phone: string;
  nickname: string;
  tenant_code: string;
  status: "active" | "disabled" | "deleted";
  first_login: boolean;
  created_at: string;
  last_login_at: string | null;
};

const STATUS_MAP = {
  active:   { label: "正常",  cls: "bg-green-50 text-green-600 border-green-100" },
  disabled: { label: "已禁用", cls: "bg-amber-50 text-amber-600 border-amber-100" },
  deleted:  { label: "已注销", cls: "bg-red-50 text-red-400 border-red-100" },
};

const inputCls = "h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);

  // 重置密码弹窗
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetOk, setResetOk] = useState(false);

  const pageSize = 20;

  const fetchUsers = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchUsers(1); setPage(1); }, [search, statusFilter]);
  useEffect(() => { fetchUsers(page); }, [page]);

  async function setStatus(user: UserRow, status: "active" | "disabled") {
    const label = status === "active" ? "恢复正常" : "禁用";
    if (!confirm(`确认${label}用户 ${user.phone}？`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-status", status }),
    });
    if (res.ok) fetchUsers(page);
  }

  async function doReset() {
    if (!resetTarget) return;
    setResetError("");
    if (resetPwd.length < 8) { setResetError("新密码至少 8 位"); return; }
    setResetSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password", newPassword: resetPwd }),
      });
      const data = await res.json();
      if (!res.ok) { setResetError(data.error ?? "操作失败"); return; }
      setResetOk(true);
    } finally {
      setResetSaving(false);
    }
  }

  function closeReset() {
    setResetTarget(null);
    setResetPwd("");
    setResetError("");
    setResetOk(false);
  }

  const totalPages = Math.ceil(total / pageSize);

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* 页头 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-[#002FA7]" />
            <h1 className="text-lg font-semibold text-gray-900">用户管理</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">共 {total} 人</span>
          </div>
          <button onClick={() => fetchUsers(page)} className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors">
            <RefreshCw size={14} /> 刷新
          </button>
        </div>

        {/* 搜索 & 筛选 */}
        <div className="bg-white rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputCls} pl-8 w-full`}
              placeholder="搜索手机号…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className={`${inputCls} pr-8`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
            <option value="deleted">已注销</option>
          </select>
        </div>

        {/* 表格 */}
        <div className="bg-white rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">用户</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">手机号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">类型 / 企业码</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">状态</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">注册时间</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">最近登录</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 rounded animate-pulse w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-14 text-center text-sm text-gray-400">暂无用户数据</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isPersonal = u.tenant_code === "PERSONAL";
                    const st = STATUS_MAP[u.status] ?? STATUS_MAP.active;
                    return (
                      <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{u.nickname || "—"}</p>
                          {u.first_login && (
                            <span className="text-[10px] text-amber-500">未改初始密码</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.phone}</td>
                        <td className="px-4 py-3">
                          <p className="text-gray-600">{isPersonal ? "个人用户" : "企业用户"}</p>
                          {!isPersonal && (
                            <p className="text-xs text-gray-400 font-mono">{u.tenant_code}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(u.last_login_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* 重置密码 */}
                            <button
                              onClick={() => { setResetTarget(u); setResetPwd(""); setResetError(""); setResetOk(false); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                              title="重置密码"
                            >
                              <KeyRound size={13} /> 重置密码
                            </button>
                            {/* 禁用 / 恢复 */}
                            {u.status === "active" && (
                              <button
                                onClick={() => setStatus(u, "disabled")}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-amber-600 hover:bg-amber-50 transition-colors"
                                title="禁用账号"
                              >
                                <ShieldOff size={13} /> 禁用
                              </button>
                            )}
                            {u.status === "disabled" && (
                              <button
                                onClick={() => setStatus(u, "active")}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-green-600 hover:bg-green-50 transition-colors"
                                title="恢复正常"
                              >
                                <ShieldCheck size={13} /> 恢复
                              </button>
                            )}
                            {u.status === "deleted" && (
                              <span className="text-xs text-gray-300 px-2">已注销</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-400">第 {page} / {totalPages} 页，共 {total} 条</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-[8px] text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded-[8px] text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 重置密码弹窗 ───────────────────────────────────── */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">重置密码</h2>
              <button onClick={closeReset} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                用户：<span className="font-medium text-gray-800">{resetTarget.phone}</span>
                {resetTarget.nickname && <span className="text-gray-400">（{resetTarget.nickname}）</span>}
              </p>
              {resetOk ? (
                <div className="p-3 bg-green-50 rounded-[12px] text-sm text-green-700 text-center">
                  密码已重置，用户下次登录需使用新密码
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">新密码（至少 8 位）</label>
                    <input
                      type="text"
                      className="h-10 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                      placeholder="输入新密码"
                      value={resetPwd}
                      onChange={(e) => { setResetPwd(e.target.value); setResetError(""); }}
                    />
                  </div>
                  {resetError && <p className="text-xs text-red-500">{resetError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={closeReset} className="flex-1 h-10 rounded-[10px] text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">取消</button>
                    <button
                      onClick={doReset}
                      disabled={resetSaving}
                      className="flex-1 h-10 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors disabled:opacity-60"
                    >
                      {resetSaving ? "保存中…" : "确认重置"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
