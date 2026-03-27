"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Key, Settings2, Bot, Tag, CheckCircle2, ExternalLink, MessageSquare, LayoutGrid, Eye, EyeOff, PlusCircle, Pencil, Check, X, Building2 } from "lucide-react";

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
  api_key_masked?: string;
  api_endpoint?: string;
  model_params?: Record<string, unknown>;
  categories?: { name: string };
  tenant_codes?: string[];
};
type Category = { id: string; name: string };
type Tenant = { id: string; code: string; name: string };
type CategoryDisplayConfig = {
  category_id: string;
  category_name: string;
  is_auto: boolean;
  is_manual: boolean;
  is_hidden: boolean;
};

const PLATFORMS = ["coze", "dify", "qingyan", "yuanqi", "openai", "other"];
const EMPTY_AGENT = { id: "", name: "", description: "", categoryId: "", platform: "coze", agentType: "chat", externalUrl: "" };
const EMPTY_API = { endpoint: "", apiKey: "", modelParams: '{"temperature": 0.7, "max_tokens": 2000}' };

export default function AgentsAdminPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"agents" | "categories">("agents");
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [showApiModal, setShowApiModal] = useState<Agent | null>(null);
  const [showAssignModal, setShowAssignModal] = useState<Agent | null>(null);
  const [showDisplayModal, setShowDisplayModal] = useState<Agent | null>(null);
  const [displayConfig, setDisplayConfig] = useState<CategoryDisplayConfig[]>([]);
  const [displayLoading, setDisplayLoading] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(EMPTY_AGENT);
  const [apiForm, setApiForm] = useState(EMPTY_API);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
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
        fetch("/api/admin/agents").then((r) => r.json()),
        fetch("/api/admin/categories").then((r) => r.json()),
        fetch("/api/admin/tenants").then((r) => r.json()),
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
  function openEdit(a: Agent) { setEditing(a); setForm({ id: a.agent_code, name: a.name, description: a.description, categoryId: a.category_id ?? "", platform: a.platform, agentType: a.agent_type ?? "chat", externalUrl: a.external_url ?? "" }); setFormError(""); setShowAgentModal(true); }
  function openApi(a: Agent) { setShowApiModal(a); setApiForm({ endpoint: a.api_endpoint ?? "", apiKey: "", modelParams: a.model_params ? JSON.stringify(a.model_params, null, 2) : '{"temperature": 0.7, "max_tokens": 2000}' }); }
  function openAssign(a: Agent) { setShowAssignModal(a); setSelectedTenants(a.tenant_codes ?? []); }

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
    if (!editing && !form.id) { setFormError("请填写智能体编号"); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/agents/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, description: form.description, categoryId: form.categoryId || null, platform: form.platform, agentType: form.agentType, externalUrl: form.externalUrl }) })
        : await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentCode: form.id, name: form.name, description: form.description, categoryId: form.categoryId || null, platform: form.platform, agentType: form.agentType, externalUrl: form.externalUrl }) });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "保存失败"); return; }
      setShowAgentModal(false); load();
    } finally { setSaving(false); }
  }

  async function handleSaveApi() {
    if (!showApiModal) return;
    setSaving(true);
    try {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(apiForm.modelParams); } catch {}
      await fetch(`/api/admin/agents/${showApiModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiEndpoint: apiForm.endpoint, apiKey: apiForm.apiKey || undefined, modelParams: params }) });
      setShowApiModal(null); load();
    } finally { setSaving(false); }
  }

  async function handleAssign() {
    if (!showAssignModal) return;
    setSaving(true);
    await fetch(`/api/admin/agents/${showAssignModal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantCodes: selectedTenants }) });
    setSaving(false); setShowAssignModal(null); load();
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

  const platformColor: Record<string, string> = { coze: "bg-blue-100 text-blue-700", dify: "bg-purple-100 text-purple-700", zhipu: "bg-green-100 text-green-700", openai: "bg-gray-100 text-gray-600", other: "bg-gray-100 text-gray-600" };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">智能体管理</h1>
            <p className="text-sm text-gray-500 mt-0.5">共 {agents.length} 个智能体</p>
          </div>
          <Button onClick={openAdd} className="gap-2"><Plus size={16} /> 新增智能体</Button>
        </div>

        <div className="flex gap-1 p-1 bg-gray-100 rounded-[12px] w-fit">
          {(["agents", "categories"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-[10px] text-sm font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab === "agents" ? "智能体列表" : "分类管理"}
            </button>
          ))}
        </div>

        {activeTab === "agents" && (
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-gray-50 rounded-[10px] animate-pulse" />)}</div>
            ) : agents.length === 0 ? (
              <div className="py-16 text-center text-gray-400"><Bot size={32} className="mx-auto mb-3 text-gray-200" /><p className="text-sm">暂无智能体，点击右上角新增</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      {["编号/名称", "分类", "类型/平台", "操作"].map((h) => <th key={h} className="px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {agents.map((a) => (
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
                        <td className="px-5 py-4"><Badge variant="muted">{a.categories?.name ?? "未分类"}</Badge></td>
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
                            <button onClick={() => openEdit(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Edit2 size={14} /></button>
                            {a.agent_type !== "external" && (
                              <button onClick={() => openApi(a)} className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors" title="API 配置"><Key size={14} /></button>
                            )}
                            <button onClick={() => openAssign(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="企业分配"><Settings2 size={14} /></button>
                            <button onClick={() => openDisplay(a)} className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors" title="分类展示配置"><LayoutGrid size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "categories" && (
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
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
                      <button onClick={() => saveEditCat(cat.id)} className="p-1.5 rounded-[6px] bg-[#002FA7] text-white hover:bg-[#002FA7]/90 transition-colors" title="确认"><Check size={13} /></button>
                      <button onClick={() => { setEditingCatId(null); setEditingCatName(""); }} className="p-1.5 rounded-[6px] hover:bg-gray-200 text-gray-400 transition-colors" title="取消"><X size={13} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2"><Tag size={15} className="text-[#002FA7]" /><span className="font-medium text-gray-800">{cat.name}</span></div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openCatAssign(cat)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="企业分配"><Building2 size={13} /></button>
                        <button onClick={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Pencil size={13} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Agent Modal */}
      {showAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editing ? "编辑智能体" : "新增智能体"}</h2>
            <div className="space-y-4">
              <Input label="智能体编号（ID）" placeholder="如 AGT-009" value={form.id} disabled={!!editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
              <Input label="名称" placeholder="如 营销文案助手" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">简介</label><textarea rows={3} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="简短描述功能…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">分类</label><select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">不分类</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
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
            <p className="text-sm text-gray-500 mb-4">
              {showDisplayModal.name} — 控制此智能体在各分类"智能体展示"中的可见性
            </p>
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

      {/* Assign Tenants Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">企业分配</h2>
            <p className="text-sm text-gray-500 mb-4">{showAssignModal.name} — 选择可以使用此智能体的企业</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tenants.map((t) => (
                <label key={t.code} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={selectedTenants.includes(t.code)} onChange={(e) => setSelectedTenants((prev) => e.target.checked ? [...prev, t.code] : prev.filter((c) => c !== t.code))} />
                  <div><p className="text-sm font-medium text-gray-800">{t.name}</p><code className="text-xs text-gray-400 font-mono">{t.code}</code></div>
                  {selectedTenants.includes(t.code) && <CheckCircle2 size={15} className="text-[#002FA7] ml-auto" />}
                </label>
              ))}
              {tenants.length === 0 && <p className="text-sm text-gray-400 text-center py-4">暂无企业，请先新增</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowAssignModal(null)}>取消</Button><Button onClick={handleAssign} loading={saving}>保存分配</Button></div>
          </div>
        </div>
      )}
      {/* Category Assign Tenants Modal */}
      {showCatAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">企业分配</h2>
            <p className="text-sm text-gray-500 mb-4">{showCatAssignModal.name} — 选择可以看到此分类的企业</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tenants.map((t) => (
                <label key={t.code} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={selectedCatTenants.includes(t.code)} onChange={(e) => setSelectedCatTenants((prev) => e.target.checked ? [...prev, t.code] : prev.filter((c) => c !== t.code))} />
                  <div><p className="text-sm font-medium text-gray-800">{t.name}</p><code className="text-xs text-gray-400 font-mono">{t.code}</code></div>
                  {selectedCatTenants.includes(t.code) && <CheckCircle2 size={15} className="text-[#002FA7] ml-auto" />}
                </label>
              ))}
              {tenants.length === 0 && <p className="text-sm text-gray-400 text-center py-4">暂无企业，请先新增</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowCatAssignModal(null)}>取消</Button><Button onClick={handleCatAssign} loading={saving}>保存分配</Button></div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
