"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Key, Settings2, Bot, Tag, CheckCircle2 } from "lucide-react";

type Agent = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
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

const PLATFORMS = ["coze", "dify", "zhipu", "openai", "other"];
const EMPTY_AGENT = { id: "", name: "", description: "", categoryId: "", platform: "coze" };
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
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState(EMPTY_AGENT);
  const [apiForm, setApiForm] = useState(EMPTY_API);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [newCatName, setNewCatName] = useState("");

  async function load() {
    setLoading(true);
    const [ar, cr, tr] = await Promise.all([
      fetch("/api/admin/agents").then((r) => r.json()),
      fetch("/api/admin/categories").then((r) => r.json()),
      fetch("/api/admin/tenants").then((r) => r.json()),
    ]);
    setAgents(Array.isArray(ar) ? ar : []);
    setCategories(Array.isArray(cr) ? cr : []);
    setTenants(Array.isArray(tr) ? tr : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); setForm(EMPTY_AGENT); setFormError(""); setShowAgentModal(true); }
  function openEdit(a: Agent) { setEditing(a); setForm({ id: a.agent_code, name: a.name, description: a.description, categoryId: a.category_id ?? "", platform: a.platform }); setFormError(""); setShowAgentModal(true); }
  function openApi(a: Agent) { setShowApiModal(a); setApiForm({ endpoint: a.api_endpoint ?? "", apiKey: "", modelParams: a.model_params ? JSON.stringify(a.model_params, null, 2) : '{"temperature": 0.7, "max_tokens": 2000}' }); }
  function openAssign(a: Agent) { setShowAssignModal(a); setSelectedTenants(a.tenant_codes ?? []); }

  async function handleSaveAgent() {
    setFormError("");
    if (!form.name || !form.platform) { setFormError("请填写名称和平台"); return; }
    if (!editing && !form.id) { setFormError("请填写智能体编号"); return; }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/agents/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, description: form.description, categoryId: form.categoryId || null, platform: form.platform }) })
        : await fetch("/api/admin/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentCode: form.id, name: form.name, description: form.description, categoryId: form.categoryId || null, platform: form.platform }) });
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

  async function addCategory() {
    if (!newCatName.trim()) return;
    await fetch("/api/admin/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCatName.trim() }) });
    setNewCatName(""); load();
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
                      {["编号/名称", "分类", "对接平台", "操作"].map((h) => <th key={h} className="px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {agents.map((a) => (
                      <tr key={a.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-[10px] bg-[#002FA7]/8 flex items-center justify-center shrink-0"><Bot size={18} className="text-[#002FA7]" /></div>
                            <div><p className="font-medium text-gray-800">{a.name}</p><code className="text-[10px] text-gray-400 font-mono">{a.agent_code}</code></div>
                          </div>
                        </td>
                        <td className="px-5 py-4"><Badge variant="muted">{a.categories?.name ?? "未分类"}</Badge></td>
                        <td className="px-5 py-4"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platformColor[a.platform] ?? "bg-gray-100 text-gray-600"}`}>{a.platform}</span></td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Edit2 size={14} /></button>
                            <button onClick={() => openApi(a)} className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors" title="API 配置"><Key size={14} /></button>
                            <button onClick={() => openAssign(a)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="企业分配"><Settings2 size={14} /></button>
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
                <div key={cat.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-[12px]">
                  <div className="flex items-center gap-2"><Tag size={15} className="text-[#002FA7]" /><span className="font-medium text-gray-800">{cat.name}</span></div>
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
              <div className="flex flex-col gap-1.5"><label className="text-sm font-medium text-gray-700">对接平台</label><select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
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
    </AdminLayout>
  );
}
