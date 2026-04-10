"use client";
import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Users, Search, RefreshCw, ShieldOff, ShieldCheck, KeyRound, X, ChevronDown, GitBranch, Trash2, Plus, Tag, Pencil, Check, UserMinus, UserPlus } from "lucide-react";

type UserRow = {
  id: string;
  phone: string;
  username: string | null;
  real_name: string | null;
  nickname: string;
  tenant_code: string;
  status: "active" | "disabled" | "deleted" | "cancelled";
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

type AdminMeta = {
  role: "super_admin" | "system_admin" | "org_admin";
  tenantCode: string | null;
};

const STATUS_MAP = {
  active:    { label: "正常",   cls: "bg-green-50 text-green-600 border-green-100" },
  disabled:  { label: "已禁用", cls: "bg-amber-50 text-amber-600 border-amber-100" },
  cancelled: { label: "已注销", cls: "bg-red-50 text-red-400 border-red-100" },
  deleted:   { label: "已删除", cls: "bg-gray-100 text-gray-400 border-gray-200" },
} as const;

const ROLE_RANK: Record<string, number> = {
  super_admin: 0, system_admin: 1, org_admin: 2, user: 3,
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

const inputCls = "h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all";

export default function AdminUsersPage() {
  const [adminMeta, setAdminMeta] = useState<AdminMeta | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [allDepts, setAllDepts] = useState<{ id: string; name: string; tenant_code: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

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

  // Tab
  const [activeTab, setActiveTab] = useState<"users" | "groups">("users");

  // 用户分组
  type UserGroup = { id: string; name: string; description: string; tenant_code: string | null; member_count: number };
  type GroupMember = { id: string; phone: string; username: string | null; real_name: string | null; nickname: string; tenant_code: string };
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [addMemberResults, setAddMemberResults] = useState<UserRow[]>([]);
  const [addMemberLoading, setAddMemberLoading] = useState(false);

  // 分配部门/小组弹窗
  const [deptTarget, setDeptTarget] = useState<UserRow | null>(null);
  const [deptOptions, setDeptOptions] = useState<{ id: string; name: string }[]>([]);
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedDept, setSelectedDept] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [deptSaving, setDeptSaving] = useState(false);

  // 用户详情抽屉
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  const [detailVisibility, setDetailVisibility] = useState<{
    workflows: { id: string; name: string; category: string | null }[];
    agents: { id: string; name: string; category: string | null }[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function openDetail(u: UserRow) {
    setDetailUser(u);
    setDetailVisibility(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/visibility`);
      if (res.ok) setDetailVisibility(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }

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
      if (orgFilter) params.set("org", orgFilter);
      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, userTypeFilter, roleFilter, deptFilter, orgFilter]);

  useEffect(() => { fetchUsers(1); setPage(1); setSelectedIds([]); }, [search, statusFilter, userTypeFilter, roleFilter, deptFilter, orgFilter]);
  useEffect(() => { fetchUsers(page); }, [page]);
  useEffect(() => { if (activeTab === "groups") loadGroups(); }, [activeTab]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/tenants").then(r => r.json()).catch(() => []),
      fetch("/api/admin/departments").then(r => r.json()).catch(() => []),
      fetch("/api/admin/me", { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([tr, dr, me]) => {
      setTenants(Array.isArray(tr) ? tr : []);
      setAllDepts(Array.isArray(dr) ? dr : []);
      if (me && me.role) setAdminMeta({ role: me.role, tenantCode: me.tenantCode ?? null });
    });
  }, []);

  // 根据当前管理员等级判断是否可管理某个目标用户
  function canManage(u: UserRow): boolean {
    if (!adminMeta) return false;
    if (u.status === "deleted") return false;
    // 组织管理员只能管自己组织内的
    if (adminMeta.role === "org_admin") {
      if (!adminMeta.tenantCode || u.tenant_code !== adminMeta.tenantCode) return false;
    }
    // super 可以管所有人；其它角色需严格高于目标
    if (adminMeta.role === "super_admin") return true;
    const actorRank = ROLE_RANK[adminMeta.role] ?? 99;
    const targetRank = ROLE_RANK[u.role] ?? 99;
    return targetRank > actorRank;
  }

  // 根据当前管理员等级筛选可分配的角色选项
  // 1) 严格低于自己
  // 2) 个人用户不能被设为组织管理员（组织管理员必须归属某个组织）
  function assignableRoles(target?: UserRow) {
    if (!adminMeta) return [];
    const actorRank = ROLE_RANK[adminMeta.role] ?? 99;
    const isPersonal =
      target?.user_type === "personal" ||
      !target?.tenant_code ||
      target?.tenant_code === "PERSONAL";
    return [
      { value: "user",         label: "普通用户",     rank: 3 },
      { value: "org_admin",    label: "组织管理员",   rank: 2 },
      { value: "system_admin", label: "系统管理员",   rank: 1 },
      { value: "super_admin",  label: "超级管理员",   rank: 0 },
    ].filter(r => {
      if (r.rank <= actorRank) return false;          // 不能高于或等于自己
      if (r.value === "org_admin" && isPersonal) return false;  // 个人用户无法当组管
      return true;
    });
  }

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

  async function batchSetStatus(status: "active" | "disabled") {
    if (selectedIds.length === 0) return;
    const label = status === "active" ? "启用" : "禁用";
    if (!confirm(`确认批量${label}已选 ${selectedIds.length} 个用户？`)) return;
    setBatchLoading(true);
    try {
      await Promise.all(selectedIds.map(id =>
        fetch(`/api/admin/users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set-status", status }),
        })
      ));
      setSelectedIds([]);
      fetchUsers(page);
    } finally {
      setBatchLoading(false);
    }
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

  async function softDeleteUser(u: UserRow) {
    if (!confirm(`确认删除用户「${u.real_name || u.nickname || u.phone}」？\n删除后将从列表中移除，操作不可撤销。`)) return;
    if (!confirm(`二次确认：真的要删除用户 ${u.phone} 吗？`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete" }),
    });
    if (res.ok) fetchUsers(page);
    else { const d = await res.json(); alert(d.error ?? "删除失败"); }
  }

  // ── 用户分组 ──────────────────────────────────────────────────
  async function loadGroups() {
    setGroupsLoading(true);
    const res = await fetch("/api/admin/user-groups");
    if (res.ok) setGroups(await res.json());
    setGroupsLoading(false);
  }

  async function addGroup() {
    if (!newGroupName.trim()) return;
    await fetch("/api/admin/user-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newGroupName.trim() }) });
    setNewGroupName(""); loadGroups();
  }

  async function saveEditGroup(id: string) {
    if (!editingGroupName.trim()) return;
    await fetch(`/api/admin/user-groups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingGroupName.trim() }) });
    setEditingGroupId(null); setEditingGroupName(""); loadGroups();
  }

  async function deleteGroup(g: UserGroup) {
    if (!confirm(`确认删除分组「${g.name}」？成员关联也会一并删除。`)) return;
    const res = await fetch(`/api/admin/user-groups/${g.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); alert(d.error ?? "删除失败"); return; }
    if (expandedGroupId === g.id) setExpandedGroupId(null);
    loadGroups();
  }

  async function loadGroupMembers(groupId: string) {
    const res = await fetch(`/api/admin/user-groups/${groupId}/members`);
    if (res.ok) { const d = await res.json(); setGroupMembers((prev) => ({ ...prev, [groupId]: d })); }
  }

  async function toggleGroupExpand(groupId: string) {
    if (expandedGroupId === groupId) { setExpandedGroupId(null); return; }
    setExpandedGroupId(groupId);
    await loadGroupMembers(groupId);
  }

  async function removeMember(groupId: string, userId: string) {
    await fetch(`/api/admin/user-groups/${groupId}/members`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
    loadGroupMembers(groupId); loadGroups();
  }

  async function searchUsersForGroup(q: string) {
    if (!q.trim()) { setAddMemberResults([]); return; }
    setAddMemberLoading(true);
    const res = await fetch(`/api/admin/users?search=${encodeURIComponent(q)}&pageSize=10&page=1`);
    if (res.ok) { const d = await res.json(); setAddMemberResults(d.users ?? []); }
    setAddMemberLoading(false);
  }

  async function addMemberToGroup(groupId: string, userId: string) {
    await fetch(`/api/admin/user-groups/${groupId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: [userId] }) });
    loadGroupMembers(groupId); loadGroups();
  }

  const totalPages = Math.ceil(total / pageSize);

  function fmtDate(s: string | null) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  const hasFilter = search || statusFilter || userTypeFilter || roleFilter || deptFilter || orgFilter;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<Users size={20} />}
          title="用户管理"
          subtitle="管理平台所有用户账号、角色及分组归属"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {total} 人</span>}
          actions={
            <>
              <div className="flex gap-1 p-1 bg-gray-100/70 rounded-[10px]">
                {(["users", "groups"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    {tab === "users" ? "用户列表" : "用户分组"}
                  </button>
                ))}
              </div>
              {activeTab === "users" && (
                <button onClick={() => fetchUsers(page)} className="flex items-center gap-1.5 px-3 h-9 rounded-[10px] text-[13px] text-gray-500 hover:bg-gray-100 transition-colors">
                  <RefreshCw size={14} /> 刷新
                </button>
              )}
            </>
          }
        />

        {activeTab === "users" && <>

        {/* 搜索 & 筛选栏 */}
        <Card padding="md" className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputCls} pl-8 w-full`}
              placeholder="搜索手机号 / 用户名 / 真实姓名…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className={`${inputCls} pr-2`} value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">全部组织</option>
            {tenants.map(t => <option key={t.id} value={t.code}>{t.name}（{t.code}）</option>)}
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
          <select className={`${inputCls} pr-2`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
            <option value="deleted">已注销</option>
          </select>
          <select className={`${inputCls} pr-2`} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">全部部门</option>
            {allDepts.map(d => <option key={d.id} value={d.id}>{d.name}（{d.tenant_code}）</option>)}
          </select>
          {hasFilter && (
            <button
              onClick={() => { setSearch(""); setStatusFilter(""); setUserTypeFilter(""); setRoleFilter(""); setDeptFilter(""); setOrgFilter(""); }}
              className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 transition-colors"
            >
              <X size={13} /> 清除
            </button>
          )}
        </Card>

        {/* 批量操作工具栏 */}
        {selectedIds.length > 0 && (
          <div className="bg-[#002FA7]/5 border border-[#002FA7]/20 rounded-[14px] px-4 py-2.5 flex items-center gap-3">
            <span className="text-sm text-[#002FA7] font-medium">已选 {selectedIds.length} 人</span>
            <button
              onClick={() => batchSetStatus("active")}
              disabled={batchLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-60"
            >
              <ShieldCheck size={13} /> 批量启用
            </button>
            <button
              onClick={() => batchSetStatus("disabled")}
              disabled={batchLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-60"
            >
              <ShieldOff size={13} /> 批量禁用
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="ml-auto text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              <X size={13} /> 取消选择
            </button>
          </div>
        )}

        {/* 表格 */}
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-sticky-head">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 w-10 text-left">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-[#002FA7] focus:ring-[#002FA7]/30"
                      checked={users.length > 0 && users.every(u => selectedIds.includes(u.id))}
                      onChange={(e) => setSelectedIds(e.target.checked ? users.map(u => u.id) : [])}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">用户名</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">真实姓名</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">手机号</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">类型</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">角色</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">所属组织</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">最近登录</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {[...Array(9)].map((_, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <div className="h-4 bg-gray-100 rounded animate-pulse w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-14 text-center text-sm text-gray-400">暂无用户数据</td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isPersonal = u.tenant_code === "PERSONAL";
                    const st = STATUS_MAP[u.status] ?? STATUS_MAP.active;
                    const ut = USER_TYPE_MAP[u.user_type] ?? USER_TYPE_MAP.organization;
                    const rl = ROLE_MAP[u.role] ?? ROLE_MAP.user;
                    const tenant = tenants.find(t => t.code === u.tenant_code);
                    const canOperate = canManage(u);
                    return (
                      <tr key={u.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${selectedIds.includes(u.id) ? "bg-blue-50/40" : ""}`}>
                        <td className="px-4 py-3.5 w-10">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 text-[#002FA7] focus:ring-[#002FA7]/30"
                            checked={selectedIds.includes(u.id)}
                            onChange={(e) => setSelectedIds(e.target.checked ? [...selectedIds, u.id] : selectedIds.filter(id => id !== u.id))}
                          />
                        </td>
                        <td className="px-4 py-3.5">
                          <button
                            onClick={() => openDetail(u)}
                            className="text-[#002FA7] hover:underline font-medium text-left"
                            title="查看详情"
                          >
                            {u.username || <span className="text-gray-300">—</span>}
                          </button>
                          {u.first_login && (
                            <p className="text-[10px] text-amber-500 mt-0.5">未改初始密码</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-gray-800">
                          {u.real_name || u.nickname || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3.5 text-gray-600 font-mono text-[13px]">{u.phone}</td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ut.cls}`}>
                            {ut.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {canOperate ? (
                            <button
                              onClick={() => openRoleModal(u)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity ${rl.cls}`}
                              title="点击修改角色"
                            >
                              {rl.label}
                              <ChevronDown size={10} />
                            </button>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${rl.cls} ${u.status === "deleted" ? "opacity-40" : ""}`}>
                              {rl.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">
                          {isPersonal ? <span className="text-gray-300">个人</span> : (
                            <>
                              <span className="text-gray-700">{tenant?.name ?? u.tenant_code}</span>
                              <span className="text-gray-400 font-mono ml-1">{u.tenant_code}</span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">{fmtDate(u.last_login_at)}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center justify-end gap-1">
                            {!canOperate ? (
                              <span className="text-xs text-gray-300 px-2">—</span>
                            ) : (
                              <>
                                <button
                                  onClick={() => openDetail(u)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                                  title="查看详情"
                                >
                                  详情
                                </button>
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
                                <button
                                  onClick={() => softDeleteUser(u)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs text-red-400 hover:bg-red-50 transition-colors"
                                  title="删除用户"
                                >
                                  <Trash2 size={13} /> 删除
                                </button>
                              </>
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
            <div className="flex items-center justify-between px-4 py-3.5 border-t border-gray-100 bg-gray-50/30">
              <span className="text-[12px] text-gray-500">第 {page} / {totalPages} 页，共 {total} 条</span>
              <div className="flex gap-1.5">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 h-8 rounded-[8px] text-[12px] border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition-colors">上一页</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 h-8 rounded-[8px] text-[12px] border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition-colors">下一页</button>
              </div>
            </div>
          )}
        </Card>

        </>}

        {/* ── 权限分组 Tab ──────────────────────────────────────── */}
        {activeTab === "groups" && (
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <input
                className="flex-1 h-10 border border-gray-200 rounded-[10px] px-4 text-sm focus:outline-none focus:border-[#002FA7]"
                placeholder="新分组名称…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGroup()}
              />
              <button onClick={addGroup} className="flex items-center gap-1.5 px-4 h-10 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors">
                <Plus size={14} /> 添加分组
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">用户分组用于智能体/工作流的访问控制，与前台「我的工作任务」分组完全独立。</p>
            {groupsLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-[10px] animate-pulse" />)}</div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">暂无分组，在上方输入名称后回车或点击添加</p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => (
                  <div key={g.id} className="border border-gray-100 rounded-[12px] overflow-hidden">
                    {/* 分组行 */}
                    <div className="flex items-center gap-2 p-3 bg-gray-50/50">
                      {editingGroupId === g.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Tag size={14} className="text-[#002FA7] shrink-0" />
                          <input
                            autoFocus
                            className="flex-1 h-8 border border-[#002FA7]/40 rounded-[8px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                            value={editingGroupName}
                            onChange={(e) => setEditingGroupName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditGroup(g.id);
                              if (e.key === "Escape") { setEditingGroupId(null); setEditingGroupName(""); }
                            }}
                          />
                          <button onClick={() => saveEditGroup(g.id)} className="p-1.5 rounded-[6px] bg-[#002FA7] text-white" title="确认"><Check size={13} /></button>
                          <button onClick={() => { setEditingGroupId(null); setEditingGroupName(""); }} className="p-1.5 rounded-[6px] hover:bg-gray-200 text-gray-400"><X size={13} /></button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => toggleGroupExpand(g.id)} className="flex items-center gap-2 flex-1 text-left">
                            <Tag size={14} className="text-[#002FA7] shrink-0" />
                            <span className="font-medium text-gray-800">{g.name}</span>
                            <span className="text-xs text-gray-400 ml-1">{g.member_count} 人</span>
                            {g.tenant_code && <span className="text-xs text-gray-400 font-mono">({g.tenant_code})</span>}
                          </button>
                          <button onClick={() => { setEditingGroupId(g.id); setEditingGroupName(g.name); }} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600" title="重命名"><Pencil size={13} /></button>
                          <button onClick={() => deleteGroup(g)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500" title="删除"><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                    {/* 展开：成员列表 */}
                    {expandedGroupId === g.id && (
                      <div className="p-3 border-t border-gray-100">
                        {/* 添加成员 */}
                        {addMemberGroupId === g.id ? (
                          <div className="mb-3">
                            <div className="flex gap-2 mb-2">
                              <input
                                autoFocus
                                className="flex-1 h-9 border border-gray-200 rounded-[8px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                                placeholder="搜索用户（手机号/用户名/姓名）…"
                                value={addMemberSearch}
                                onChange={(e) => { setAddMemberSearch(e.target.value); searchUsersForGroup(e.target.value); }}
                              />
                              <button onClick={() => { setAddMemberGroupId(null); setAddMemberSearch(""); setAddMemberResults([]); }} className="px-3 h-9 rounded-[8px] text-xs text-gray-400 hover:bg-gray-100 border border-gray-200">取消</button>
                            </div>
                            {addMemberLoading && <p className="text-xs text-gray-400 py-2">搜索中…</p>}
                            {addMemberResults.length > 0 && (
                              <div className="border border-gray-100 rounded-[8px] divide-y divide-gray-50 max-h-48 overflow-y-auto">
                                {addMemberResults.map((u) => {
                                  const alreadyIn = (groupMembers[g.id] ?? []).some((m) => m.id === u.id);
                                  return (
                                    <div key={u.id} className="flex items-center justify-between px-3 py-2">
                                      <div>
                                        <p className="text-sm text-gray-800">{u.real_name || u.nickname || "—"}</p>
                                        <p className="text-xs text-gray-400 font-mono">{u.phone}</p>
                                      </div>
                                      <button
                                        onClick={() => !alreadyIn && addMemberToGroup(g.id, u.id)}
                                        disabled={alreadyIn}
                                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs font-medium transition-colors ${alreadyIn ? "text-gray-300 cursor-not-allowed" : "text-[#002FA7] hover:bg-[#002FA7]/10"}`}
                                      >
                                        <UserPlus size={12} /> {alreadyIn ? "已在分组" : "添加"}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button onClick={() => { setAddMemberGroupId(g.id); setAddMemberSearch(""); setAddMemberResults([]); }} className="flex items-center gap-1 text-xs text-[#002FA7] hover:underline mb-2">
                            <UserPlus size={12} /> 添加成员
                          </button>
                        )}
                        {/* 成员列表 */}
                        {(groupMembers[g.id] ?? []).length === 0 ? (
                          <p className="text-xs text-gray-400 py-2 text-center">暂无成员</p>
                        ) : (
                          <div className="space-y-1.5">
                            {(groupMembers[g.id] ?? []).map((m) => (
                              <div key={m.id} className="flex items-center justify-between px-2 py-1.5 rounded-[8px] hover:bg-gray-50">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-[#002FA7]/10 text-[#002FA7] text-xs font-bold flex items-center justify-center shrink-0">
                                    {(m.real_name || m.nickname || m.phone).charAt(0)}
                                  </div>
                                  <div>
                                    <p className="text-sm text-gray-800">{m.real_name || m.nickname || "—"}</p>
                                    <p className="text-xs text-gray-400 font-mono">{m.phone}</p>
                                  </div>
                                </div>
                                <button onClick={() => removeMember(g.id, m.id)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="移出分组"><UserMinus size={12} /></button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
                  {assignableRoles(roleTarget ?? undefined).map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {assignableRoles(roleTarget ?? undefined).length === 0 && (
                  <p className="text-xs text-red-500">无可分配角色（权限不足或个人用户无法作为组织管理员）</p>
                )}
                {(roleTarget?.user_type === "personal" || !roleTarget?.tenant_code || roleTarget?.tenant_code === "PERSONAL") && (
                  <p className="text-xs text-amber-600">该用户为个人用户，无法设为「组织管理员」</p>
                )}
              </div>
              <div className="p-3 bg-amber-50 rounded-[10px] text-xs text-amber-700 space-y-1">
                <p>只能分配**严格低于**你自己的角色。</p>
                <p>当前你是：<span className="font-semibold">{ROLE_MAP[adminMeta?.role ?? "user"]?.label ?? "未知"}</span></p>
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

      {/* ── 用户详情抽屉 ──────────────────────────────────────── */}
      {detailUser && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailUser(null)} />
          <div className="relative w-full max-w-[560px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* 头部 */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-12 h-12 rounded-[12px] bg-[#002FA7]/8 text-[#002FA7] flex items-center justify-center font-bold text-lg shrink-0">
                  {(detailUser.real_name || detailUser.nickname || detailUser.phone).charAt(0)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-[18px] font-semibold text-gray-900 truncate">{detailUser.real_name || detailUser.nickname || "—"}</h2>
                  <p className="text-[13px] text-gray-500 mt-0.5">
                    @{detailUser.username || "—"}
                    <span className="mx-2 text-gray-300">·</span>
                    {detailUser.phone}
                  </p>
                </div>
              </div>
              <button onClick={() => setDetailUser(null)} className="p-2 rounded-[8px] hover:bg-gray-100 text-gray-400"><X size={18} /></button>
            </div>

            {/* 内容 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* 基础资料 */}
              <section>
                <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-3">基础资料</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">用户类型</p>
                    <p className="text-gray-800">{USER_TYPE_MAP[detailUser.user_type]?.label ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">系统角色</p>
                    <p className="text-gray-800">{ROLE_MAP[detailUser.role]?.label ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">账号状态</p>
                    <p className="text-gray-800">{STATUS_MAP[detailUser.status]?.label ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">注册时间</p>
                    <p className="text-gray-800">{fmtDate(detailUser.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">最近登录</p>
                    <p className="text-gray-800">{fmtDate(detailUser.last_login_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">初始密码</p>
                    <p className="text-gray-800">{detailUser.first_login ? <span className="text-amber-600">未修改</span> : "已修改"}</p>
                  </div>
                </div>
              </section>

              {/* 组织归属 */}
              <section>
                <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-3">组织归属</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">所属组织</p>
                    <p className="text-gray-800">
                      {detailUser.tenant_code === "PERSONAL" ? "个人" : (tenants.find(t => t.code === detailUser.tenant_code)?.name ?? detailUser.tenant_code)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">组织码</p>
                    <p className="text-gray-800 font-mono text-[13px]">{detailUser.tenant_code === "PERSONAL" ? "—" : detailUser.tenant_code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">部门</p>
                    <p className="text-gray-800">{detailUser.departments?.name ?? <span className="text-gray-300">未分配</span>}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">小组</p>
                    <p className="text-gray-800">{detailUser.teams?.name ?? <span className="text-gray-300">未分配</span>}</p>
                  </div>
                </div>
              </section>

              {/* 可见工作流 */}
              <section>
                <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <GitBranch size={14} className="text-[#002FA7]" /> 可见工作流
                  {detailVisibility && <span className="text-gray-400 font-normal">（{detailVisibility.workflows.length}）</span>}
                </h3>
                {detailLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-[8px] animate-pulse" />)}
                  </div>
                ) : !detailVisibility || detailVisibility.workflows.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-[10px]">该用户暂无可见工作流</p>
                ) : (
                  <div className="space-y-1.5">
                    {detailVisibility.workflows.map(w => (
                      <div key={w.id} className="flex items-center justify-between px-3 py-2 rounded-[8px] bg-gray-50/70">
                        <span className="text-sm text-gray-800 truncate">{w.name}</span>
                        {w.category && <span className="text-[11px] text-gray-400 shrink-0 ml-2">{w.category}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* 可见智能体 */}
              <section>
                <h3 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Users size={14} className="text-[#002FA7]" /> 可见智能体
                  {detailVisibility && <span className="text-gray-400 font-normal">（{detailVisibility.agents.length}）</span>}
                </h3>
                {detailLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-[8px] animate-pulse" />)}
                  </div>
                ) : !detailVisibility || detailVisibility.agents.length === 0 ? (
                  <p className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-[10px]">该用户暂无可见智能体</p>
                ) : (
                  <div className="space-y-1.5">
                    {detailVisibility.agents.map(a => (
                      <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-[8px] bg-gray-50/70">
                        <span className="text-sm text-gray-800 truncate">{a.name}</span>
                        {a.category && <span className="text-[11px] text-gray-400 shrink-0 ml-2">{a.category}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* 底部快捷操作 */}
            <div className="border-t border-gray-100 px-6 py-4 flex items-center gap-2">
              {canManage(detailUser) && detailUser.tenant_code !== "PERSONAL" && (
                <button
                  onClick={() => { openDeptModal(detailUser); setDetailUser(null); }}
                  className="flex items-center gap-1.5 px-3 h-9 rounded-[10px] text-sm text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                >
                  <GitBranch size={14} /> 分配部门
                </button>
              )}
              <button onClick={() => setDetailUser(null)} className="ml-auto px-4 h-9 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors">关闭</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
