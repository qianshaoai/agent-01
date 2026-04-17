"use client";
import { useState, useEffect, useMemo } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Key, Settings2, Bot, Tag, CheckCircle2, ExternalLink, MessageSquare, LayoutGrid, Eye, EyeOff, PlusCircle, Pencil, Check, X, Building2, Image as ImageIcon } from "lucide-react";

type Agent = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
  agent_type: string;
  external_url: string;
  enabled: boolean;
  category_id: string | null;
  categoryIds?: string[];
  api_key_masked?: string;
  api_endpoint?: string;
  model_params?: Record<string, unknown>;
  categories?: { name: string; icon_url?: string | null };
  categoriesAll?: { id: string; name: string; icon_url: string | null }[];
  tenant_codes?: string[];
  permissions?: { scope_type: string; scope_id: string | null }[];
};
type Category = { id: string; name: string; icon_url?: string | null };
type Tenant = { id: string; code: string; name: string };
type Permission = { id: string; scope_type: string; scope_id: string | null; scope_label: string };
type Dept = { id: string; name: string; tenant_code: string };
type Team = { id: string; name: string; dept_id: string };

const SCOPE_TYPE_LABELS: Record<string, string> = {
  all: "全部用户", org: "组织", dept: "部门", team: "小组", user: "用户", user_type: "用户类型", group: "按分组",
};
type CategoryDisplayConfig = {
  category_id: string;
  category_name: string;
  is_auto: boolean;
  is_manual: boolean;
  is_hidden: boolean;
};

const PLATFORMS = ["coze", "dify", "qingyan", "yuanqi", "openai", "other"];
const EMPTY_AGENT = { id: "", name: "", description: "", categoryIds: [] as string[], platform: "coze", agentType: "chat", externalUrl: "" };
const EMPTY_API = { endpoint: "", apiKey: "", modelParams: '{"temperature": 0.7, "max_tokens": 2000}' };

export default function AgentsAdminPage() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"agents" | "categories">("agents");
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showApiModal, setShowApiModal] = useState<Agent | null>(null);
  const [showDisplayModal, setShowDisplayModal] = useState<Agent | null>(null);
  const [displayConfig, setDisplayConfig] = useState<CategoryDisplayConfig[]>([]);
  const [displayLoading, setDisplayLoading] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(EMPTY_AGENT);
  const [apiForm, setApiForm] = useState(EMPTY_API);
  const [saving, setSaving] = useState(false);
  const [agentTypeFilter, setAgentTypeFilter] = useState("");
  const [agentCategoryFilter, setAgentCategoryFilter] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] = useState("");

  // 权限弹窗状态
  const [showPermModal, setShowPermModal] = useState<Agent | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [newScopeType, setNewScopeType] = useState("org");
  const [newScopeId, setNewScopeId] = useState("");
  const [addingPerm, setAddingPerm] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [userGroups, setUserGroups] = useState<{ id: string; name: string }[]>([]);
  const [formError, setFormError] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [showCatAssignModal, setShowCatAssignModal] = useState<Category | null>(null);
  const [selectedCatTenants, setSelectedCatTenants] = useState<string[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [ar, cr, tr] = await Promise.all([
        fetch("/api/admin/agents").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/categories").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/tenants").then((r) => r.json()).then(d => d.data ?? d),
      ]);
      setAgents(Array.isArray(ar) ? ar : []);
      setCategories(Array.isArray(cr) ? cr : []);
      setTenants(Array.isArray(tr) ? tr : []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); setForm(EMPTY_AGENT); setFormError(""); setShowAgentModal(true); }
  function openEdit(a: Agent) { setEditing(a); setForm({ id: a.agent_code, name: a.name, description: a.description, categoryIds: a.categoryIds ?? (a.category_id ? [a.category_id] : []), platform: a.platform, agentType: a.agent_type ?? "chat", externalUrl: a.external_url ?? "" }); setFormError(""); setShowAgentModal(true); }
  function openApi(a: Agent) { setShowApiModal(a); setApiForm({ endpoint: a.api_endpoint ?? "", apiKey: "", modelParams: a.model_params ? JSON.stringify(a.model_params, null, 2) : '{"temperature": 0.7, "max_tokens": 2000}' }); }

  async function openPermModal(a: Agent) {
    setShowPermModal(a);
    setPermLoading(true);
    setNewScopeType("org");
    setNewScopeId("");

    // 权限数据每次都要刷新（和具体 agent 相关）；部门/团队/分组只拉一次做页面级缓存
    const permsPromise = fetch(`/api/admin/resource-permissions?resource_type=agent&resource_id=${a.id}`).then(r => r.json()).catch(() => []);
    const needOrgData = depts.length === 0 && teams.length === 0 && userGroups.length === 0;

    if (needOrgData) {
      const [permsData, deptsData, teamsData, groupsData] = await Promise.all([
        permsPromise,
        fetch("/api/admin/departments").then(r => r.json()).then(d => d.data ?? d).catch(() => []),
        fetch("/api/admin/teams").then(r => r.json()).then(d => d.data ?? d).catch(() => []),
        fetch("/api/admin/user-groups").then(r => r.json()).then(d => d.data ?? d).catch(() => []),
      ]);
      setPermissions(Array.isArray(permsData) ? permsData : []);
      setDepts(Array.isArray(deptsData) ? deptsData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
      setUserGroups(Array.isArray(groupsData) ? groupsData : []);
    } else {
      const permsData = await permsPromise;
      setPermissions(Array.isArray(permsData) ? permsData : []);
    }
    setPermLoading(false);
  }

  async function refreshPerms() {
    if (!showPermModal) return;
    const data = await fetch(`/api/admin/resource-permissions?resource_type=agent&resource_id=${showPermModal.id}`).then(r => r.json()).catch(() => []);
    setPermissions(Array.isArray(data) ? data : []);
  }

  async function deletePerm(permId: string) {
    await fetch("/api/admin/resource-permissions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: permId }) });
    await refreshPerms();
  }

  async function addPerm() {
    if (!showPermModal) return;
    if (newScopeType !== "all" && !newScopeId) return;
    setAddingPerm(true);
    const res = await fetch("/api/admin/resource-permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceType: "agent", resourceId: showPermModal.id, scopeType: newScopeType, scopeId: newScopeType === "all" ? null : newScopeId }),
    });
    setAddingPerm(false);
    if (res.ok) { setNewScopeId(""); await refreshPerms(); load(); }
  }

  async function openDisplay(a: Agent) {
    setShowDisplayModal(a);
    setDisplayLoading(true);
    const data = await fetch(`/api/admin/category-display?agentId=${a.id}`).then((r) => r.json()).catch(() => []);
    setDisplayConfig(Array.isArray(data) ? data : []);
    setDisplayLoading(false);
  }

  async function toggleDisplayConfig(agentId: string, categoryId: string, field: "isManual" | "isHidden", currentValue: boolean) {
    await fetch("/api/admin/category-display", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, categoryId, [field]: !currentValue }),
    });
    // 刷新展示配置
    const data = await fetch(`/api/admin/category-display?agentId=${agentId}`).then((r) => r.json()).catch(() => []);
    setDisplayConfig(Array.isArray(data) ? data : []);
  }

  async function handleSaveAgent() {
    setFormError("");
    if (!form.name || !form.platform) { setFormError("请填写名称和平台"); return; }
    if (!form.id) { setFormError("请填写智能体编号"); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/agents/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentCode: form.id, name: form.name, description: form.description, categoryIds: form.categoryIds, platform: form.platform, agentType: form.agentType, externalUrl: form.externalUrl }) })
        : await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentCode: form.id, name: form.name, description: form.description, categoryIds: form.categoryIds, platform: form.platform, agentType: form.agentType, externalUrl: form.externalUrl }) });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "保存失败"); return; }
      setShowAgentModal(false); load(); toast(editing ? "智能体已更新" : "智能体已创建");
    } finally { setSaving(false); }
  }

  async function handleSaveApi() {
    if (!showApiModal) return;
    setSaving(true);
    try {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(apiForm.modelParams); } catch {}
      await fetch(`/api/admin/agents/${showApiModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiEndpoint: apiForm.endpoint, apiKey: apiForm.apiKey || undefined, modelParams: params }) });
      setShowApiModal(null); load(); toast("API 配置已保存");
    } finally { setSaving(false); }
  }

  async function openCatAssign(cat: Category) {
    setShowCatAssignModal(cat);
    const data = await fetch(`/api/admin/categories/${cat.id}`).then((r) => r.json()).catch(() => ({}));
    setSelectedCatTenants(data.tenant_codes ?? []);
  }

  async function handleCatAssign() {
    if (!showCatAssignModal) return;
    setSaving(true);
    await fetch(`/api/admin/categories/${showCatAssignModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantCodes: selectedCatTenants }) });
    setSaving(false); setShowCatAssignModal(null);
  }

  async function addCategory() {
    if (!newCatName.trim()) return;
    await fetch("/api/admin/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCatName.trim() }) });
    setNewCatName(""); load();
  }

  async function saveEditCat(id: string) {
    const newName = editingCatName.trim();
    if (!newName) return;
    const res = await fetch(`/api/admin/categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) });
    if (res.ok) {
      setCategories((prev) => prev.map((c) => c.id === id ? { ...c, name: newName } : c));
    }
    setEditingCatId(null);
    setEditingCatName("");
  }

  async function handleCatIcon(catId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/categories/${catId}/icon`, { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, icon_url: data.url } : c));
    } else {
      const d = await res.json();
      alert(d.error ?? "图标上传失败");
    }
    e.target.value = "";
  }

  async function removeCatIcon(catId: string) {
    if (!confirm("确认删除此分类的图标？")) return;
    const res = await fetch(`/api/admin/categories/${catId}/icon`, { method: "DELETE" });
    if (res.ok) {
      setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, icon_url: null } : c));
    }
  }

  const platformColor: Record<string, string> = { coze: "bg-blue-100 text-blue-700", dify: "bg-purple-100 text-purple-700", zhipu: "bg-green-100 text-green-700", openai: "bg-gray-100 text-gray-600", other: "bg-gray-100 text-gray-600" };

  const filteredAgents = useMemo(() => agents.filter(a => {
    if (agentTypeFilter && a.agent_type !== agentTypeFilter) return false;
    if (agentCategoryFilter && a.category_id !== agentCategoryFilter) return false;
    if (agentStatusFilter === "enabled" && !a.enabled) return false;
    if (agentStatusFilter === "disabled" && a.enabled) return false;
    return true;
  }), [agents, agentTypeFilter, agentCategoryFilter, agentStatusFilter]);
  const hasAgentFilter = agentTypeFilter || agentCategoryFilter || agentStatusFilter;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<Bot size={20} />}
          title="智能体管理"
          subtitle="管理所有智能体、分类与权限配置"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {agents.length} 个</span>}
          actions={
            <>
              <div className="flex gap-1 p-1 bg-gray-100/70 rounded-[10px]">
                {(["agents", "categories"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    {tab === "agents" ? "智能体列表" : "分类管理"}
                  </button>
                ))}
              </div>
              <Button onClick={openAdd} className="gap-2"><Plus size={16} /> 新增智能体</Button>
            </>
          }
        />

        {activeTab === "agents" && (
          <>
          <Card padding="md" className="flex flex-wrap gap-3 items-center">
            <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={agentTypeFilter} onChange={e => setAgentTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              <option value="chat">对话型</option>
              <option value="external">外链型</option>
            </select>
            <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={agentCategoryFilter} onChange={e => setAgentCategoryFilter(e.target.value)}>
              <option value="">全部分类</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={agentStatusFilter} onChange={e => setAgentStatusFilter(e.target.value)}>
              <option value="">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
            </select>
            {hasAgentFilter && (
              <button onClick={() => { setAgentTypeFilter(""); setAgentCategoryFilter(""); setAgentStatusFilter(""); }} className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2">
                <X size={13} /> 清除
              </button>
            )}
            <span className="ml-auto text-[12px] text-gray-500">{filteredAgents.length} / {agents.length} 个</span>
          </Card>
          <Card padding="none" className="overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-50 rounded-[10px] animate-pulse" />)}</div>
            ) : filteredAgents.length === 0 ? (
              <div className="py-16 text-center text-gray-400"><Bot size={32} className="mx-auto mb-3 text-gray-200" /><p className="text-sm">{agents.length === 0 ? "暂无智能体，点击右上角新增" : "没有符合筛选条件的智能体"}</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-sticky-head">
                  <thead>
                    <tr>
                      {["编号/名称", "分类", "类型/平台", "操作"].map((h) => <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredAgents.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${a.agent_type === "external" ? "bg-orange-50" : "bg-[#002FA7]/8"}`}>
                              {a.agent_type === "external"
                                ? <ExternalLink size={16} className="text-orange-500" />
                                : <Bot size={18} className="text-[#002FA7]" />}
                            </div>
                            <div><p className="font-medium text-gray-800">{a.name}</p><code className="text-[10px] text-gray-400 font-mono">{a.agent_code}</code></div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {a.categoriesAll && a.categoriesAll.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {a.categoriesAll.map((c) => (
                                <span key={c.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                                  {/* 小图标（<20px），next/image 优化收益低 */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  {c.icon_url ? <img src={c.icon_url} alt={c.name} className="w-3.5 h-3.5 rounded-[3px] object-contain" /> : <Tag size={10} />}
                                  {c.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <Badge variant="muted">未分类</Badge>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {a.agent_type === "external" ? (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700 flex items-center gap-1"><ExternalLink size={10} />外链</span>
                            ) : (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platformColor[a.platform] ?? "bg-gray-100 text-gray-600"}`}>{a.platform}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑" aria-label="编辑"><Edit2 size={14} /></button>
                            {a.agent_type !== "external" && (
                              <button onClick={() => openApi(a)} className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors" title="API 配置" aria-label="API 配置"><Key size={14} /></button>
                            )}
                            <button onClick={() => openPermModal(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="权限设置" aria-label="权限设置"><Settings2 size={14} /></button>
                            <button onClick={() => openDisplay(a)} className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors" title="分类展示配置" aria-label="分类展示配置"><LayoutGrid size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          </>
        )}

        {activeTab === "categories" && (
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <input className="flex-1 h-10 border border-gray-200 rounded-[10px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" placeholder="新分类名称…" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} />
              <Button size="sm" onClick={addCategory} className="gap-1"><Plus size={14} /> 添加</Button>
            </div>
            <div className="space-y-2">
              {categories.length === 0 ? <p className="text-sm text-gray-400 text-center py-6">暂无分类</p> : categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-[12px]">
                  {editingCatId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Tag size={15} className="text-[#002FA7] shrink-0" />
                      <input
                        autoFocus
                        className="flex-1 h-9 border border-[#002FA7]/40 rounded-[8px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                        value={editingCatName}
                        onChange={(e) => setEditingCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditCat(cat.id);
                          if (e.key === "Escape") { setEditingCatId(null); setEditingCatName(""); }
                        }}
                      />
                      <button onClick={() => saveEditCat(cat.id)} className="p-1.5 rounded-[6px] bg-[#002FA7] text-white hover:bg-[#002FA7]/90 transition-colors" title="确认" aria-label="确认"><Check size={13} /></button>
                      <button onClick={() => { setEditingCatId(null); setEditingCatName(""); }} className="p-1.5 rounded-[6px] hover:bg-gray-200 text-gray-400 transition-colors" title="取消" aria-label="取消"><X size={13} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        {cat.icon_url ? (
                          <div className="w-8 h-8 rounded-[8px] overflow-hidden bg-white border border-gray-200 flex items-center justify-center">
                            {/* 用户上传图标，URL 动态不在 next/image remotePatterns 内 */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cat.icon_url} alt={cat.name} className="w-full h-full object-contain" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-[8px] bg-[#002FA7]/8 flex items-center justify-center">
                            <Tag size={15} className="text-[#002FA7]" />
                          </div>
                        )}
                        <span className="font-medium text-gray-800">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors cursor-pointer" title={cat.icon_url ? "替换图标" : "上传图标"}>
                          <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={(e) => handleCatIcon(cat.id, e)} />
                          <ImageIcon size={13} />
                        </label>
                        {cat.icon_url && (
                          <button onClick={() => removeCatIcon(cat.id)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除图标" aria-label="删除图标">
                            <X size={13} />
                          </button>
                        )}
                        <button onClick={() => openCatAssign(cat)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="组织分配" aria-label="组织分配"><Building2 size={13} /></button>
                        <button onClick={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="编辑" aria-label="编辑"><Pencil size={13} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Agent Modal */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editing ? "编辑智能体" : "新增智能体"}</h2>
            <div className="space-y-4">
              <Input label="智能体编号（ID）" placeholder="如 AGT-009" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
              <Input label="名称" placeholder="如 营销文案助手" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">简介</label><textarea rows={3} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="简短描述功能…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">所属分类（可多选）</label>
                {categories.length === 0 ? (
                  <p className="text-xs text-gray-400">暂无分类，请先在&quot;分类管理&quot;Tab 中创建</p>
                ) : (
                  <>
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-40 overflow-y-auto space-y-1.5">
                      {categories.map((cat) => {
                        const checked = form.categoryIds.includes(cat.id);
                        return (
                          <label key={cat.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-1">
                            <input
                              type="checkbox"
                              className="accent-[#002FA7] w-4 h-4"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? form.categoryIds.filter((id) => id !== cat.id)
                                  : [...form.categoryIds, cat.id];
                                setForm({ ...form, categoryIds: next });
                              }}
                            />
                            {cat.icon_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cat.icon_url} alt={cat.name} className="w-5 h-5 rounded-[4px] object-contain" />
                            ) : (
                              <Tag size={14} className="text-gray-400" />
                            )}
                            <span className="text-sm text-gray-700">{cat.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400">可为智能体勾选多个分类，便于在多个分类下显示。不选则不出现在任何分类下。</p>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">智能体类型</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="agentType" value="chat" checked={form.agentType === "chat"} onChange={() => setForm({ ...form, agentType: "chat" })} className="accent-[#002FA7]" />
                    <MessageSquare size={14} className="text-[#002FA7]" /><span className="text-sm">站内对话型</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="agentType" value="external" checked={form.agentType === "external"} onChange={() => setForm({ ...form, agentType: "external" })} className="accent-[#002FA7]" />
                    <ExternalLink size={14} className="text-orange-500" /><span className="text-sm">外链跳转型</span>
                  </label>
                </div>
              </div>
              {form.agentType === "external" && (
                <Input label="跳转链接 URL" placeholder="https://example.com/tool" value={form.externalUrl} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} />
              )}
              {form.agentType === "chat" && (
                <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">对接平台</label><select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
              )}
              {formError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{formError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowAgentModal(false)}>取消</Button><Button onClick={handleSaveAgent} loading={saving}>{editing ? "保存" : "创建"}</Button></div>
          </div>
        </div>
      )}

      {/* API Config Modal */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">API 配置</h2>
            <p className="text-sm text-gray-500 mb-5">{showApiModal.agent_code} · {showApiModal.name} · {showApiModal.platform}</p>
            <div className="space-y-4">
              <Input label="API Endpoint" placeholder="https://api.coze.cn/v3/chat" value={apiForm.endpoint} onChange={(e) => setApiForm({ ...apiForm, endpoint: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">API Key <span className="text-xs font-normal text-gray-400">（加密存储，当前已配置：{showApiModal.api_key_masked || "未配置"}）</span></label>
                <input type="password" placeholder="输入新 Key 覆盖，留空保持不变" className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" value={apiForm.apiKey} onChange={(e) => setApiForm({ ...apiForm, apiKey: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">模型参数（JSON）</label><textarea rows={4} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm font-mono focus:outline-none focus:border-[#002FA7] resize-none" value={apiForm.modelParams} onChange={(e) => setApiForm({ ...apiForm, modelParams: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowApiModal(null)}>取消</Button><Button onClick={handleSaveApi} loading={saving}>保存配置</Button></div>
          </div>
        </div>
      )}

      {/* Category Display Modal */}
      {showDisplayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">分类展示配置</h2>
            <p className="text-sm text-gray-500 mb-2">
              {showDisplayModal.name} — 控制此智能体在各分类「智能体展示」中的可见性
            </p>
            {!displayLoading && displayConfig.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <button onClick={async () => {
                  const items = displayConfig.filter(c => !c.is_manual).map(c => ({ categoryId: c.category_id, isManual: true }));
                  if (items.length === 0) return;
                  await fetch("/api/admin/category-display", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: showDisplayModal.id, items }) });
                  const data = await fetch(`/api/admin/category-display?agentId=${showDisplayModal.id}`).then(r => r.json()).catch(() => []);
                  setDisplayConfig(Array.isArray(data) ? data : []);
                }} className="text-xs text-[#002FA7] hover:underline">一键全选</button>
                <span className="text-gray-300">·</span>
                <button onClick={async () => {
                  const items = displayConfig.filter(c => c.is_manual).map(c => ({ categoryId: c.category_id, isManual: false }));
                  if (items.length === 0) return;
                  await fetch("/api/admin/category-display", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: showDisplayModal.id, items }) });
                  const data = await fetch(`/api/admin/category-display?agentId=${showDisplayModal.id}`).then(r => r.json()).catch(() => []);
                  setDisplayConfig(Array.isArray(data) ? data : []);
                }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">全部取消</button>
              </div>
            )}
            {displayLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-[10px] animate-pulse" />)}</div>
            ) : displayConfig.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">暂无分类</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {displayConfig.map((cfg) => (
                  <div key={cfg.category_id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[12px]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{cfg.category_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {cfg.is_auto && <span className="mr-2 text-blue-500">自动同步（工作流）</span>}
                        {cfg.is_manual && <span className="mr-2 text-green-600">手动添加</span>}
                        {cfg.is_hidden && <span className="text-red-500">已隐藏</span>}
                        {!cfg.is_auto && !cfg.is_manual && !cfg.is_hidden && <span className="text-gray-300">未展示</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* 手动添加（仅对非自动同步的有意义） */}
                      <button
                        onClick={() => toggleDisplayConfig(showDisplayModal.id, cfg.category_id, "isManual", cfg.is_manual)}
                        title={cfg.is_manual ? "取消手动添加" : "手动添加到此分类展示"}
                        className={`p-1.5 rounded-[8px] transition-colors ${cfg.is_manual ? "bg-green-100 text-green-600" : "hover:bg-gray-200 text-gray-400"}`}
                      >
                        <PlusCircle size={14} />
                      </button>
                      {/* 隐藏（对自动同步和手动添加的都有效） */}
                      <button
                        onClick={() => toggleDisplayConfig(showDisplayModal.id, cfg.category_id, "isHidden", cfg.is_hidden)}
                        title={cfg.is_hidden ? "取消隐藏" : "在此分类中隐藏"}
                        className={`p-1.5 rounded-[8px] transition-colors ${cfg.is_hidden ? "bg-red-100 text-red-500" : "hover:bg-gray-200 text-gray-400"}`}
                      >
                        {cfg.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 p-3 bg-[#f0f4ff] rounded-[10px]">
              <p className="text-xs text-[#002FA7]">
                <strong>说明：</strong>自动同步来自工作流步骤绑定；手动添加可补充未在工作流中的智能体；隐藏优先级最高，会覆盖自动同步。
              </p>
            </div>
            <div className="flex justify-end mt-4">
              <Button variant="ghost" onClick={() => setShowDisplayModal(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {/* 权限设置弹窗 */}
      {showPermModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
            <h2 className="font-semibold text-gray-900 mb-0.5">权限设置</h2>
            <p className="text-sm text-gray-500 mb-4">{showPermModal.name} — 控制哪些用户可以访问此智能体</p>

            {/* 当前权限列表 */}
            <div className="mb-4 flex-1 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">当前权限</p>
              {permLoading ? (
                <div className="h-10 bg-gray-50 rounded-[10px] animate-pulse" />
              ) : permissions.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-[10px] text-sm text-amber-700">
                  暂无权限配置 — 所有人均无法访问此智能体
                </div>
              ) : (
                <div className="space-y-2">
                  {permissions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-[10px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 text-xs px-2 py-0.5 bg-[#e8eeff] text-[#002FA7] rounded-full font-medium">
                          {SCOPE_TYPE_LABELS[p.scope_type] ?? p.scope_type}
                        </span>
                        <span className="text-sm text-gray-700 truncate">{p.scope_label}</span>
                      </div>
                      <button onClick={() => deletePerm(p.id)} className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 添加权限 */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">添加权限</p>
              <div className="flex gap-2 mb-2 flex-wrap">
                <select value={newScopeType} onChange={e => { setNewScopeType(e.target.value); setNewScopeId(""); }}
                  className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white shrink-0">
                  <option value="all">全部用户</option>
                  <option value="user_type">用户类型</option>
                  <option value="org">按组织</option>
                  <option value="dept">按部门</option>
                  <option value="team">按小组</option>
                  <option value="user">指定用户(ID)</option>
                  <option value="group">按分组</option>
                </select>
                {newScopeType === "group" && (
                  <select value={newScopeId} onChange={e => setNewScopeId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white">
                    <option value="">请选择分组</option>
                    {userGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
                {newScopeType === "user_type" && (
                  <select value={newScopeId} onChange={e => setNewScopeId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white">
                    <option value="">请选择</option>
                    <option value="personal">个人用户</option>
                    <option value="organization">组织用户</option>
                  </select>
                )}
                {newScopeType === "org" && (
                  <select value={newScopeId} onChange={e => setNewScopeId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white">
                    <option value="">请选择组织</option>
                    {tenants.map(t => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
                  </select>
                )}
                {newScopeType === "dept" && (
                  <select value={newScopeId} onChange={e => setNewScopeId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white">
                    <option value="">请选择部门</option>
                    {depts.map(d => <option key={d.id} value={d.id}>{d.name} ({d.tenant_code})</option>)}
                  </select>
                )}
                {newScopeType === "team" && (
                  <select value={newScopeId} onChange={e => setNewScopeId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] bg-white">
                    <option value="">请选择小组</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {newScopeType === "user" && (
                  <input value={newScopeId} onChange={e => setNewScopeId(e.target.value)} placeholder="粘贴用户 ID"
                    className="flex-1 h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]" />
                )}
              </div>
              <button onClick={addPerm} disabled={addingPerm || (newScopeType !== "all" && !newScopeId)}
                className="w-full h-9 bg-[#002FA7] text-white rounded-[8px] text-sm font-medium hover:bg-[#001f7a] transition-colors disabled:opacity-50">
                {addingPerm ? "添加中…" : "+ 添加权限"}
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="ghost" onClick={() => { setShowPermModal(null); load(); }}>关闭</Button>
            </div>
          </div>
        </div>
      )}
      {/* Category Assign Tenants Modal */}
      {showCatAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">组织分配</h2>
            <p className="text-sm text-gray-500 mb-2">{showCatAssignModal.name} — 选择可以看到此分类的组织</p>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setSelectedCatTenants(tenants.map(t => t.code))} className="text-xs text-[#002FA7] hover:underline">一键全选</button>
              <span className="text-gray-300">·</span>
              <button onClick={() => setSelectedCatTenants([])} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">全部取消</button>
              <span className="ml-auto text-xs text-gray-400">已选 {selectedCatTenants.length} / {tenants.length}</span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tenants.map((t) => (
                <label key={t.code} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={selectedCatTenants.includes(t.code)} onChange={(e) => setSelectedCatTenants((prev) => e.target.checked ? [...prev, t.code] : prev.filter((c) => c !== t.code))} />
                  <div><p className="text-sm font-medium text-gray-800">{t.name}</p><code className="text-xs text-gray-400 font-mono">{t.code}</code></div>
                  {selectedCatTenants.includes(t.code) && <CheckCircle2 size={15} className="text-[#002FA7] ml-auto" />}
                </label>
              ))}
              {tenants.length === 0 && <p className="text-sm text-gray-400 text-center py-4">暂无组织，请先新增</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowCatAssignModal(null)}>取消</Button><Button onClick={handleCatAssign} loading={saving}>保存分配</Button></div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
