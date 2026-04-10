"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Plus, Search, Edit2, Ban, Calendar, Zap, CheckCircle2, Building2,
  ChevronRight, ChevronDown, GitBranch, Users, Pencil, Trash2, X, Check,
} from "lucide-react";

type Tenant = {
  id: string; code: string; name: string;
  quota: number; quota_used: number; expires_at: string; enabled: boolean;
};
type Department = { id: string; tenant_code: string; name: string; sort_order: number };
type Team = { id: string; dept_id: string; tenant_code: string; name: string; sort_order: number };

const EMPTY_FORM = { code: "", name: "", initialPwd: "", quota: "500", expiresAt: "" };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // 展开的组织结构
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Record<string, Department[]>>({});
  const [teams, setTeams] = useState<Record<string, Team[]>>({});
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  // 部门内联编辑
  const [newDeptName, setNewDeptName] = useState<Record<string, string>>({});
  const [editingDept, setEditingDept] = useState<{ id: string; name: string } | null>(null);
  // 小组内联编辑
  const [newTeamName, setNewTeamName] = useState<Record<string, string>>({});
  const [editingTeam, setEditingTeam] = useState<{ id: string; name: string } | null>(null);

  const [structErr, setStructErr] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/tenants");
    if (res.ok) setTenants(await res.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = tenants.filter(
    (t) => t.code.toLowerCase().includes(search.toLowerCase()) || t.name.includes(search)
  );

  // ── 展开组织结构 ─────────────────────────────────────────────
  async function toggleExpand(t: Tenant) {
    if (expandedTenant === t.id) { setExpandedTenant(null); return; }
    setExpandedTenant(t.id);
    setStructErr("");
    if (!departments[t.code]) await loadDepts(t.code);
  }

  async function loadDepts(tenantCode: string) {
    const res = await fetch(`/api/admin/departments?tenantCode=${tenantCode}`);
    if (res.ok) {
      const data: Department[] = await res.json();
      setDepartments((prev) => ({ ...prev, [tenantCode]: data }));
      // 预加载所有部门的小组
      for (const dept of data) {
        await loadTeams(dept.id);
      }
    }
  }

  async function loadTeams(deptId: string) {
    const res = await fetch(`/api/admin/teams?deptId=${deptId}`);
    if (res.ok) {
      const data: Team[] = await res.json();
      setTeams((prev) => ({ ...prev, [deptId]: data }));
    }
  }

  // ── 部门操作 ─────────────────────────────────────────────────
  async function addDept(tenantCode: string) {
    const name = newDeptName[tenantCode]?.trim();
    if (!name) return;
    setStructErr("");
    const res = await fetch("/api/admin/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantCode, name }),
    });
    if (res.ok) {
      setNewDeptName((p) => ({ ...p, [tenantCode]: "" }));
      await loadDepts(tenantCode);
    } else {
      const d = await res.json();
      setStructErr(d.error ?? "添加失败");
    }
  }

  async function saveDept(dept: Department) {
    if (!editingDept) return;
    const res = await fetch(`/api/admin/departments/${dept.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingDept.name }),
    });
    if (res.ok) { setEditingDept(null); await loadDepts(dept.tenant_code); }
  }

  async function deleteDept(dept: Department) {
    if (!confirm(`确认删除部门「${dept.name}」？小组也会一并删除。`)) return;
    const res = await fetch(`/api/admin/departments/${dept.id}`, { method: "DELETE" });
    if (res.ok) {
      setTeams((p) => { const n = { ...p }; delete n[dept.id]; return n; });
      await loadDepts(dept.tenant_code);
    } else {
      const d = await res.json();
      setStructErr(d.error ?? "删除失败");
    }
  }

  // ── 小组操作 ─────────────────────────────────────────────────
  async function addTeam(dept: Department) {
    const name = newTeamName[dept.id]?.trim();
    if (!name) return;
    setStructErr("");
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId: dept.id, tenantCode: dept.tenant_code, name }),
    });
    if (res.ok) {
      setNewTeamName((p) => ({ ...p, [dept.id]: "" }));
      await loadTeams(dept.id);
    } else {
      const d = await res.json();
      setStructErr(d.error ?? "添加失败");
    }
  }

  async function saveTeam(team: Team) {
    if (!editingTeam) return;
    const res = await fetch(`/api/admin/teams/${team.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingTeam.name }),
    });
    if (res.ok) { setEditingTeam(null); await loadTeams(team.dept_id); }
  }

  async function deleteTeam(team: Team) {
    if (!confirm(`确认删除小组「${team.name}」？`)) return;
    const res = await fetch(`/api/admin/teams/${team.id}`, { method: "DELETE" });
    if (res.ok) await loadTeams(team.dept_id);
    else { const d = await res.json(); setStructErr(d.error ?? "删除失败"); }
  }

  // ── 租户表单 ─────────────────────────────────────────────────
  function openAdd() { setEditing(null); setForm(EMPTY_FORM); setFormError(""); setShowModal(true); }
  function openEdit(t: Tenant) {
    setEditing(t);
    setForm({ code: t.code, name: t.name, initialPwd: "", quota: String(t.quota), expiresAt: t.expires_at });
    setFormError(""); setShowModal(true);
  }
  async function toggleEnabled(t: Tenant) {
    await fetch(`/api/admin/tenants/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !t.enabled }) });
    load();
  }

  async function deleteTenant(t: Tenant) {
    if (!confirm(`确认删除组织「${t.name}（${t.code}）」？\n此操作不可撤销。`)) return;
    const res = await fetch(`/api/admin/tenants/${t.id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const d = await res.json();
      alert(d.error ?? "删除失败");
    }
  }
  async function handleSave() {
    setFormError("");
    if (!form.name || !form.quota || !form.expiresAt) { setFormError("请填写组织名称、配额和到期日"); return; }
    if (!editing && (!form.code || !form.initialPwd)) { setFormError("新建时请填写组织码和初始密码"); return; }
    if (!editing && !/^[A-Za-z]{4,8}$/.test(form.code.trim())) { setFormError("组织码只能为 4~8 位英文字母"); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/tenants/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, quota: form.quota, expiresAt: form.expiresAt, initialPwd: form.initialPwd || undefined }) })
        : await fetch("/api/admin/tenants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: form.code, name: form.name, initialPwd: form.initialPwd, quota: form.quota, expiresAt: form.expiresAt }) });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "保存失败"); return; }
      setShowModal(false); load();
    } finally { setSaving(false); }
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<Building2 size={20} />}
          title="组织码管理"
          subtitle="管理所有组织、部门与小组"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {tenants.length} 家</span>}
          actions={<Button onClick={openAdd} className="gap-2"><Plus size={16} /> 新增组织码</Button>}
        />

        <Card padding="sm">
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full h-10 pl-9 pr-4 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" placeholder="搜索组织名称或组织码…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Card>

        <div className="space-y-3">
          {loading ? (
            <div className="card p-6 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-[10px] animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card py-16 text-center text-gray-400">
              <Building2 size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm">{search ? "没有匹配的组织" : "暂无组织，点击右上角新增"}</p>
            </div>
          ) : (
            filtered.map((t) => {
              const pct = Math.round((t.quota_used / t.quota) * 100);
              const expired = new Date(t.expires_at) < new Date();
              const isExpanded = expandedTenant === t.id;
              const depts = departments[t.code] ?? [];

              return (
                <div key={t.id} className="card overflow-hidden">
                  {/* 主行 */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <button onClick={() => toggleExpand(t)} className="p-1 rounded-[8px] hover:bg-gray-100 text-gray-400 shrink-0">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <code className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-[6px] text-xs font-mono shrink-0">{t.code}</code>
                    <span className="font-medium text-gray-800 flex-1">{t.name}</span>
                    {/* 配额 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Zap size={12} className="text-amber-500" />
                      <span className={`text-xs font-medium ${pct >= 100 ? "text-red-500" : "text-gray-600"}`}>{t.quota_used}/{t.quota}</span>
                    </div>
                    {/* 到期 */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Calendar size={12} className="text-gray-400" />
                      <span className={`text-xs ${expired ? "text-red-500 font-medium" : "text-gray-500"}`}>{t.expires_at}</span>
                      {expired && <Badge variant="danger">已到期</Badge>}
                    </div>
                    <Badge variant={t.enabled ? "success" : "muted"} >{t.enabled ? "启用" : "禁用"}</Badge>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEdit(t)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Edit2 size={14} /></button>
                      <button onClick={() => toggleEnabled(t)} className={`p-1.5 rounded-[8px] transition-colors ${t.enabled ? "hover:bg-red-50 text-gray-400 hover:text-red-500" : "hover:bg-green-50 text-gray-400 hover:text-green-500"}`} title={t.enabled ? "禁用" : "启用"}>{t.enabled ? <Ban size={14} /> : <CheckCircle2 size={14} />}</button>
                      <button onClick={() => deleteTenant(t)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除"><Trash2 size={14} /></button>
                    </div>
                  </div>

                  {/* 展开：组织结构 */}
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 pb-5 pt-4 bg-gray-50/40">
                      <div className="flex items-center gap-2 mb-3">
                        <GitBranch size={14} className="text-[#002FA7]" />
                        <span className="text-sm font-semibold text-gray-700">组织结构</span>
                        <span className="text-xs text-gray-400">（组织 → 部门 → 小组）</span>
                      </div>

                      {structErr && (
                        <div className="mb-3 p-2 bg-red-50 rounded-[8px] text-xs text-red-500 flex items-center justify-between gap-1">
                          <span>{structErr}</span>
                          <button onClick={() => setStructErr("")} className="p-0.5 rounded hover:bg-red-100 shrink-0"><X size={12} /></button>
                        </div>
                      )}

                      {/* 部门列表 */}
                      <div className="space-y-2">
                        {depts.length === 0 && (
                          <p className="text-xs text-gray-400 py-2">暂无部门，在下方添加</p>
                        )}
                        {depts.map((dept) => {
                          const deptTeams = teams[dept.id] ?? [];
                          const isDeptExpanded = expandedDept === dept.id;
                          return (
                            <div key={dept.id} className="border border-gray-100 rounded-[12px] bg-white overflow-hidden">
                              {/* 部门行 */}
                              <div className="flex items-center gap-2 px-3 py-2.5">
                                <button onClick={() => setExpandedDept(isDeptExpanded ? null : dept.id)} className="p-0.5 rounded hover:bg-gray-100 text-gray-400">
                                  {isDeptExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                                <Users size={13} className="text-[#002FA7] shrink-0" />
                                {editingDept?.id === dept.id ? (
                                  <input
                                    autoFocus
                                    className="flex-1 h-7 border border-[#002FA7]/40 rounded-[6px] px-2 text-sm focus:outline-none focus:border-[#002FA7]"
                                    value={editingDept.name}
                                    onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveDept(dept); if (e.key === "Escape") setEditingDept(null); }}
                                  />
                                ) : (
                                  <span className="flex-1 text-sm font-medium text-gray-700">{dept.name}</span>
                                )}
                                <span className="text-xs text-gray-400">{deptTeams.length} 个小组</span>
                                {editingDept?.id === dept.id ? (
                                  <>
                                    <button onClick={() => saveDept(dept)} className="p-1 rounded hover:bg-green-50 text-green-600"><Check size={13} /></button>
                                    <button onClick={() => setEditingDept(null)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X size={13} /></button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => setEditingDept({ id: dept.id, name: dept.name })} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"><Pencil size={12} /></button>
                                    <button onClick={() => deleteDept(dept)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>
                                  </>
                                )}
                              </div>

                              {/* 小组列表 */}
                              {isDeptExpanded && (
                                <div className="border-t border-gray-50 px-4 pb-3 pt-2 bg-gray-50/60 space-y-1.5">
                                  {deptTeams.length === 0 && (
                                    <p className="text-xs text-gray-400 py-1">暂无小组</p>
                                  )}
                                  {deptTeams.map((team) => (
                                    <div key={team.id} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-[8px] border border-gray-100">
                                      <div className="w-1.5 h-1.5 rounded-full bg-[#002FA7]/30 shrink-0" />
                                      {editingTeam?.id === team.id ? (
                                        <input
                                          autoFocus
                                          className="flex-1 h-6 border border-[#002FA7]/40 rounded-[6px] px-2 text-xs focus:outline-none focus:border-[#002FA7]"
                                          value={editingTeam.name}
                                          onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                                          onKeyDown={(e) => { if (e.key === "Enter") saveTeam(team); if (e.key === "Escape") setEditingTeam(null); }}
                                        />
                                      ) : (
                                        <span className="flex-1 text-xs text-gray-600">{team.name}</span>
                                      )}
                                      {editingTeam?.id === team.id ? (
                                        <>
                                          <button onClick={() => saveTeam(team)} className="p-0.5 rounded hover:bg-green-50 text-green-600"><Check size={11} /></button>
                                          <button onClick={() => setEditingTeam(null)} className="p-0.5 rounded hover:bg-gray-100 text-gray-400"><X size={11} /></button>
                                        </>
                                      ) : (
                                        <>
                                          <button onClick={() => setEditingTeam({ id: team.id, name: team.name })} className="p-0.5 rounded hover:bg-gray-100 text-gray-400"><Pencil size={11} /></button>
                                          <button onClick={() => deleteTeam(team)} className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={11} /></button>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                  {/* 新增小组 */}
                                  <div className="flex items-center gap-2 mt-2">
                                    <input
                                      className="flex-1 h-7 border border-gray-200 rounded-[8px] px-3 text-xs focus:outline-none focus:border-[#002FA7]"
                                      placeholder="新小组名称…"
                                      value={newTeamName[dept.id] ?? ""}
                                      onChange={(e) => setNewTeamName((p) => ({ ...p, [dept.id]: e.target.value }))}
                                      onKeyDown={(e) => e.key === "Enter" && addTeam(dept)}
                                    />
                                    <button onClick={() => addTeam(dept)} className="h-7 px-3 bg-[#002FA7] text-white text-xs rounded-[8px] hover:bg-[#001f7a] transition-colors flex items-center gap-1">
                                      <Plus size={11} /> 添加
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 新增部门 */}
                      <div className="flex items-center gap-2 mt-3">
                        <input
                          className="flex-1 h-9 border border-gray-200 rounded-[10px] px-3 text-sm bg-white focus:outline-none focus:border-[#002FA7]"
                          placeholder="新部门名称…"
                          value={newDeptName[t.code] ?? ""}
                          onChange={(e) => setNewDeptName((p) => ({ ...p, [t.code]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && addDept(t.code)}
                        />
                        <button onClick={() => addDept(t.code)} className="h-9 px-4 bg-[#002FA7] text-white text-sm rounded-[10px] hover:bg-[#001f7a] transition-colors flex items-center gap-1.5 shrink-0">
                          <Plus size={14} /> 添加部门
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 新增/编辑组织弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editing ? "编辑组织码" : "新增组织码"}</h2>
            <div className="space-y-4">
              <Input label="组织码（4~8 位英文字母）" placeholder="如 DEMO" value={form.code} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8) })} />
              <Input label="组织名称" placeholder="如 前哨科技有限公司" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label={editing ? "组织初始密码（留空不修改）" : "组织初始密码"} type="password" placeholder={editing ? "留空则不修改" : "设置初始密码"} value={form.initialPwd} onChange={(e) => setForm({ ...form, initialPwd: e.target.value })} />
              <Input label="总配额（次数）" type="number" placeholder="500" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
              <Input label="到期日" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              {formError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{formError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowModal(false)}>取消</Button>
              <Button onClick={handleSave} loading={saving}>{editing ? "保存修改" : "创建"}</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
