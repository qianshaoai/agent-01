"use client";
import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Users, Search, RefreshCw, ShieldOff, ShieldCheck, KeyRound, X, ChevronDown, GitBranch } from "lucide-react";

type UserRow = {
  id: string;
  phone: string;
  nickname: string;
  tenant_code: string;
  status: "active" | "disabled" | "deleted";
  first_login: boolean;
  created_at: string;
  last_login_at: string | null;
  user_type: "personal" | "organization";
  role: "super_admin" | "system_admin" | "org_admin" | "user";
  dept_id: string | null;
  team_id: string | null;
  departments?: { name: string } | null;
  teams?: { name: string } | null;
};

const STATUS_MAP = {
  active:   { label: "正常",   cls: "bg-green-50 text-green-600 border-green-100" },
  disabled: { label: "已禁用", cls: "bg-amber-50 text-amber-600 border-amber-100" },
  deleted:  { label: "已注销", cls: "bg-red-50 text-red-400 border-red-100" },
};

const USER_TYPE_MAP = {
  personal:     { label: "个人用户", cls: "bg-purple-50 text-purple-600 border-purple-100" },
  organization: { label: "组织用户", cls: "bg-blue-50 text-blue-600 border-blue-100" },
};

const ROLE_MAP = {
  super_admin:  { label: "超级管理员", cls: "bg-red-50 text-red-600 border-red-100" },
  system_admin: { label: "系统管理员", cls: "bg-orange-50 text-orange-600 border-orange-100" },
  org_admin:    { label: "组织管理员", cls: "bg-indigo-50 text-indigo-600 border-indigo-100" },
  user:         { label: "普通用户",   cls: "bg-gray-50 text-gray-500 border-gray-200" },
};

const ROLE_OPTIONS = [
  { value: "user",         label: "普通用户" },
  { value: "org_admin",    label: "组织管理员" },
  { value: "system_admin", label: "系统管理员" },
  { value: "super_admin",  label: "超级管理员" },
];

const inputCls = "h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [loading, setLoading] = useState(false);

  // 重置密码弹窗
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetOk, setResetOk] = useState(false);

  // 修改角色弹窗
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [roleSaving, setRoleSaving] = useState(false);

  // 分配部门/小组弹窗
  const [deptTarget, setDeptTarget] = useState<UserRow | null>(null);
  const [deptOptions, setDeptOptions] = useState<{ id: string; name: string }[]>([]);
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [deptSaving, setDeptSaving] = useState(false);

  const pageSize = 20;

  const fetchUsers = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (userTypeFilter) params.set("user_type", userTypeFilter);
      if (roleFilter) params.set("role", roleFilter);
      if (deptFilter) params.set("dept_id", deptFilter);
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, userTypeFilter, roleFilter]);

  useEffect(() => { fetchUsers(1); setPage(1); }, [search, statusFilter, userTypeFilter, roleFilter, deptFilter]);
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

  async function doSetRole() {
    if (!roleTarget || !newRole) return;
    setRoleSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${roleTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-role", role: newRole }),
      });
      if (res.ok) { setRoleTarget(null); fetchUsers(page); }
    } finally {
      setRoleSaving(false);
    }
  }

  function closeReset() {
    setResetTarget(null); setResetPwd(""); setResetError(""); setResetOk(false);
  }

  function openRoleModal(u: UserRow) {
    setRoleTarget(u); setNewRole(u.role);
  }

  async function openDeptModal(u: UserRow) {
    setDeptTarget(u);
    setSelectedDept(u.dept_id ?? "");
    setSelectedTeam(u.team_id ?? "");
    setTeamOptions([]);
    // 加载部门列表
    const res = await fetch(`/api/admin/departments?tenantCode=${encodeURIComponent(u.tenant_code)}`);
    const data = await res.json();
    setDeptOptions(Array.isArray(data) ? data : []);
    // 如果已有部门，加载对应小组
    if (u.dept_id) {
      const tRes = await fetch(`/api/admin/teams?deptId=${u.dept_id}`);
      const tData = await tRes.json();
      setTeamOptions(Array.isArray(tData) ? tData : []);
    }
  }

  async function handleDeptChange(deptId: string) {
    setSelectedDept(deptId);
    setSelectedTeam("");
    setTeamOptions([]);
    if (!deptId) return;
    const res = await fetch(`/api/admin/teams?deptId=${deptId}`);
    const data = await res.json();
    setTeamOptions(Array.isArray(data) ? data : []);
  }

  async function doSetDept() {
    if (!deptTarget) return;
    setDeptSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${deptTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-dept", deptId: selectedDept || null, teamId: selectedTeam || null }),
      });
      if (res.ok) { setDeptTarget(null); fetchUsers(page); }
    } finally {
      setDeptSaving(false);
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  const hasFilter = search || statusFilter || userTypeFilter || roleFilter || deptFilter;

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
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputCls} pl-8 w-full`}
              placeholder="搜索手机号…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={`${inputCls} pr-2`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
            <option value="deleted">已注销</option>
          </select>
          <select className={`${inputCls} pr-2`} value={userTypeFilter} onChange={(e) => setUserTypeFilter(e.target.value)}>
            <option value="">全部类型</option>
            <option value="personal">个人用户</option>
            <option value="organization">组织用户</option>
          </select>
          <select className={`${inputCls} pr-2`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">全部角色</option>
            <option value="super_admin">超级管理员</option>
            <option value="system_admin">系统管理员</option>
            <option value="org_admin">组织管理员</option>
            <option value="user">普通用户</option>
          </select>
          <input
            className={`${inputCls} w-36`}
            placeholder="按部门ID筛选…"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
          />
          {hasFilter && (
            <button
              onClick={() => { setSearch(""); setStatusFilter(""); setUserTypeFilter(""); setRoleFilter(""); setDeptFilter(""); }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              <X size={13} /> 清除筛选
            </button>
          )}
        </div>

        {/* 表格 */}
        <div className="bg-white rounded-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">用户</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">手机号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">用户类型</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">系统角色</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">组织码</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">部门 / 小组</th>
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
                      {[...Array(9)].map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 rounded animate-pulse w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-sm text-gray-400">暂无用户数据</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isPersonal = u.tenant_code === "PERSONAL";
                    const st = STATUS_MAP[u.status] ?? STATUS_MAP.active;
                    const ut = USER_TYPE_MAP[u.user_type] ?? USER_TYPE_MAP.organization;
                    const rl = ROLE_MAP[u.role] ?? ROLE_MAP.user;
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
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ut.cls}`}>
                            {ut.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openRoleModal(u)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity ${rl.cls}`}
                            title="点击修改角色"
                          >
                            {rl.label}
                            <ChevronDown size={10} />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                          {isPersonal ? "—" : u.tenant_code}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {u.departments?.name
                            ? <span>{u.departments.name}{u.teams?.name ? <span className="text-gray-400"> / {u.teams.name}</span> : null}</span>
                            : <span className="text-gray-300">—</span>}
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
                            {!isPersonal && (
                              <button
                                onClick={() => openDeptModal(u)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="分配部门/小组"
                              >
                                <GitBranch size={13} /> 分配部门
                              </button>
                            )}
                            <button
                              onClick={() => { setResetTarget(u); setResetPwd(""); setResetError(""); setResetOk(false); }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                              title="重置密码"
                            >
                              <KeyRound size={13} /> 重置密码
                            </button>
                            {u.status === "active" && (
                              <button
                                onClick={() => setStatus(u, "disabled")}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-amber-600 hover:bg-amber-50 transition-colors"
                              >
                                <ShieldOff size={13} /> 禁用
                              </button>
                            )}
                            {u.status === "disabled" && (
                              <button
                                onClick={() => setStatus(u, "active")}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-green-600 hover:bg-green-50 transition-colors"
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
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-[8px] text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">上一页</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-[8px] text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">下一页</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 重置密码弹窗 ─────────────────────────────────────── */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">重置密码</h2>
              <button onClick={closeReset} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                用户：<span className="font-medium text-gray-800">{resetTarget.phone}</span>
                {resetTarget.nickname && <span className="text-gray-400">（{resetTarget.nickname}）</span>}
              </p>
              {resetOk ? (
                <div className="p-3 bg-green-50 rounded-[12px] text-sm text-green-700 text-center">密码已重置，用户下次登录需使用新密码</div>
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
                    <button onClick={doReset} disabled={resetSaving} className="flex-1 h-10 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors disabled:opacity-60">
                      {resetSaving ? "保存中…" : "确认重置"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 修改角色弹窗 ─────────────────────────────────────── */}
      {roleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">修改系统角色</h2>
              <button onClick={() => setRoleTarget(null)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                用户：<span className="font-medium text-gray-800">{roleTarget.phone}</span>
                {roleTarget.nickname && <span className="text-gray-400">（{roleTarget.nickname}）</span>}
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">选择角色</label>
                <select
                  className="h-10 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="p-3 bg-gray-50 rounded-[10px] text-xs text-gray-500 space-y-1">
                <p><span className="font-medium text-red-600">超级管理员</span>：最高权限，可管理一切</p>
                <p><span className="font-medium text-orange-600">系统管理员</span>：平台日常管理权限</p>
                <p><span className="font-medium text-indigo-600">组织管理员</span>：仅管理所属组织</p>
                <p><span className="font-medium text-gray-600">普通用户</span>：仅使用平台功能</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setRoleTarget(null)} className="flex-1 h-10 rounded-[10px] text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">取消</button>
                <button onClick={doSetRole} disabled={roleSaving} className="flex-1 h-10 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors disabled:opacity-60">
                  {roleSaving ? "保存中…" : "确认修改"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── 分配部门/小组弹窗 ──────────────────────────────────── */}
      {deptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">分配部门 / 小组</h2>
              <button onClick={() => setDeptTarget(null)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                用户：<span className="font-medium text-gray-800">{deptTarget.phone}</span>
                {deptTarget.nickname && <span className="text-gray-400">（{deptTarget.nickname}）</span>}
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">部门</label>
                <select
                  className="h-10 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                  value={selectedDept}
                  onChange={(e) => handleDeptChange(e.target.value)}
                >
                  <option value="">— 不分配部门 —</option>
                  {deptOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {selectedDept && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600">小组（可选）</label>
                  <select
                    className="h-10 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                    value={selectedTeam}
                    onChange={(e) => setSelectedTeam(e.target.value)}
                  >
                    <option value="">— 不分配小组 —</option>
                    {teamOptions.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {teamOptions.length === 0 && (
                    <p className="text-xs text-gray-400">该部门暂无小组</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setDeptTarget(null)} className="flex-1 h-10 rounded-[10px] text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors">取消</button>
                <button onClick={doSetDept} disabled={deptSaving} className="flex-1 h-10 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors disabled:opacity-60">
                  {deptSaving ? "保存中…" : "确认分配"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
