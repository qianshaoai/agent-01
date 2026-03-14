"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Edit2,
  Trash2,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  GripVertical,
} from "lucide-react";

type Agent = { id: string; agent_code: string; name: string; agent_type: string; external_url: string };
type Category = { id: string; name: string };

type WorkflowStep = {
  id: string;
  step_order: number;
  title: string;
  description: string;
  exec_type: "agent" | "manual";
  agent_id: string | null;
  button_text: string;
  enabled: boolean;
};

type Workflow = {
  id: string;
  name: string;
  description: string;
  category: string;
  sort_order: number;
  enabled: boolean;
  visible_to: string;
  categoryIds: string[];
  workflow_steps: WorkflowStep[];
};

const EMPTY_WF = { name: "", description: "", category: "", sortOrder: 0, enabled: true, visibleTo: "all", categoryIds: [] as string[] };
const EMPTY_STEP = { title: "", description: "", execType: "agent" as "agent" | "manual", agentId: "", buttonText: "进入智能体", enabled: true, stepOrder: 1 };

export default function WorkflowsAdminPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Workflow modal
  const [showWfModal, setShowWfModal] = useState(false);
  const [editingWf, setEditingWf] = useState<Workflow | null>(null);
  const [wfForm, setWfForm] = useState(EMPTY_WF);
  const [wfError, setWfError] = useState("");

  // Step modal
  const [showStepModal, setShowStepModal] = useState<{ workflowId: string; step?: WorkflowStep } | null>(null);
  const [stepForm, setStepForm] = useState<{ title: string; description: string; execType: "agent" | "manual"; agentId: string; buttonText: string; enabled: boolean; stepOrder: number }>(EMPTY_STEP);
  const [stepError, setStepError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [wr, ar, cr] = await Promise.all([
        fetch("/api/admin/workflows").then((r) => r.json()),
        fetch("/api/admin/agents").then((r) => r.json()),
        fetch("/api/admin/categories").then((r) => r.json()),
      ]);
      setWorkflows(Array.isArray(wr) ? wr : []);
      setAgents(Array.isArray(ar) ? ar : []);
      setCategories(Array.isArray(cr) ? cr : []);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Workflow CRUD ──────────────────────────────────────────────
  function openAddWf() { setEditingWf(null); setWfForm(EMPTY_WF); setWfError(""); setShowWfModal(true); }
  function openEditWf(wf: Workflow) {
    setEditingWf(wf);
    setWfForm({ name: wf.name, description: wf.description, category: wf.category, sortOrder: wf.sort_order, enabled: wf.enabled, visibleTo: wf.visible_to, categoryIds: wf.categoryIds ?? [] });
    setWfError(""); setShowWfModal(true);
  }

  async function handleSaveWf() {
    setWfError("");
    if (!wfForm.name.trim()) { setWfError("请填写工作流名称"); return; }
    setSaving(true);
    try {
      const body = { name: wfForm.name, description: wfForm.description, category: wfForm.category, sortOrder: wfForm.sortOrder, enabled: wfForm.enabled, visibleTo: wfForm.visibleTo, categoryIds: wfForm.categoryIds };
      const res = editingWf
        ? await fetch(`/api/admin/workflows/${editingWf.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/workflows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setWfError(data.error ?? "保存失败"); return; }
      setShowWfModal(false); load();
    } finally { setSaving(false); }
  }

  async function toggleWfEnabled(wf: Workflow) {
    await fetch(`/api/admin/workflows/${wf.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !wf.enabled }) });
    load();
  }

  async function deleteWf(wf: Workflow) {
    if (!confirm(`确认删除工作流「${wf.name}」？步骤也会一并删除。`)) return;
    await fetch(`/api/admin/workflows/${wf.id}`, { method: "DELETE" });
    load();
  }

  // ── Step CRUD ──────────────────────────────────────────────────
  function openAddStep(workflowId: string, currentStepCount: number) {
    setShowStepModal({ workflowId });
    setStepForm({ ...EMPTY_STEP, stepOrder: currentStepCount + 1 });
    setStepError("");
  }
  function openEditStep(workflowId: string, step: WorkflowStep) {
    setShowStepModal({ workflowId, step });
    setStepForm({ title: step.title, description: step.description, execType: step.exec_type, agentId: step.agent_id ?? "", buttonText: step.button_text, enabled: step.enabled, stepOrder: step.step_order });
    setStepError("");
  }

  async function handleSaveStep() {
    setStepError("");
    if (!stepForm.title.trim()) { setStepError("请填写步骤标题"); return; }
    if (!showStepModal) return;
    setSaving(true);
    try {
      // manual 类型不绑定智能体，清空 agent_id
      const body = { stepOrder: stepForm.stepOrder, title: stepForm.title, description: stepForm.description, execType: stepForm.execType, agentId: stepForm.execType === "agent" ? (stepForm.agentId || null) : null, buttonText: stepForm.buttonText, enabled: stepForm.enabled };
      const res = showStepModal.step
        ? await fetch(`/api/admin/workflow-steps/${showStepModal.step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/workflows/${showStepModal.workflowId}/steps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setStepError(data.error ?? "保存失败"); return; }
      // 保存后保持工作流展开状态
      const parentId = showStepModal.workflowId;
      setShowStepModal(null);
      setExpandedId(parentId);
      load();
    } finally { setSaving(false); }
  }

  async function deleteStep(step: WorkflowStep) {
    if (!confirm(`确认删除步骤「${step.title}」？`)) return;
    await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "DELETE" });
    load();
  }

  async function toggleStepEnabled(step: WorkflowStep) {
    await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !step.enabled }) });
    load();
  }

  const getAgent = (agentId: string | null): Agent | null => {
    if (!agentId) return null;
    return agents.find((a) => a.id === agentId) ?? null;
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">工作流管理</h1>
            <p className="text-sm text-gray-500 mt-0.5">共 {workflows.length} 个工作流</p>
          </div>
          <Button onClick={openAddWf} className="gap-2"><Plus size={16} /> 新增工作流</Button>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white rounded-[16px] animate-pulse" />)}</div>
        ) : workflows.length === 0 ? (
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] py-16 text-center text-gray-400">
            <GitBranch size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm">暂无工作流，点击右上角新增</p>
          </div>
        ) : (
          <div className="space-y-3">
            {workflows.map((wf) => {
              const isExpanded = expandedId === wf.id;
              const steps = [...(wf.workflow_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
              return (
                <div key={wf.id} className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
                  {/* Workflow header */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <button onClick={() => setExpandedId(isExpanded ? null : wf.id)} className="p-1 rounded-[8px] hover:bg-gray-100 text-gray-400">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{wf.name}</p>
                        {wf.category && <span className="text-xs px-2 py-0.5 rounded-full bg-[#002FA7]/8 text-[#002FA7] font-medium">{wf.category}</span>}
                        {(wf.categoryIds ?? []).map((cid) => {
                          const cat = categories.find((c) => c.id === cid);
                          return cat ? <span key={cid} className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">#{cat.name}</span> : null;
                        })}
                        {wf.visible_to !== "all" && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium" title={`仅限：${wf.visible_to}`}>限定可见</span>}
                        {!wf.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">已停用</span>}
                      </div>
                      {wf.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{wf.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-gray-400 mr-2">{steps.length} 个步骤</span>
                      <button onClick={() => toggleWfEnabled(wf)} className={`p-1.5 rounded-[8px] transition-colors ${wf.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`} title={wf.enabled ? "停用" : "启用"}>
                        {wf.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => openEditWf(wf)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Edit2 size={14} /></button>
                      <button onClick={() => deleteWf(wf)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除"><Trash2 size={14} /></button>
                    </div>
                  </div>

                  {/* Steps */}
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 pb-4 pt-3">
                      <div className="space-y-2">
                        {steps.length === 0 ? (
                          <p className="text-sm text-gray-400 py-3 text-center">暂无步骤</p>
                        ) : (
                          steps.map((step, idx) => (
                            <div key={step.id} className={`flex items-start gap-3 p-3 rounded-[12px] ${step.enabled ? "bg-gray-50" : "bg-gray-50/50 opacity-60"}`}>
                              <GripVertical size={14} className="text-gray-300 mt-0.5 shrink-0" />
                              <div className="w-6 h-6 rounded-full bg-[#002FA7]/10 text-[#002FA7] text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-800">{step.title}</p>
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${step.exec_type === "agent" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}>
                                    {step.exec_type === "agent" ? <><Bot size={10} />智能体</> : <><User size={10} />人工</>}
                                  </span>
                                </div>
                                {step.description && <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>}
                                {step.exec_type === "agent" && step.agent_id && (
                                  <p className="text-xs text-[#002FA7] mt-1 flex items-center gap-1">
                                    {getAgent(step.agent_id)?.agent_type === "external" ? <ExternalLink size={10} /> : <Bot size={10} />}
                                    绑定：{getAgent(step.agent_id)?.name ?? step.agent_id}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => toggleStepEnabled(step)} className={`p-1 rounded-[6px] transition-colors text-xs ${step.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`}>
                                  {step.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                </button>
                                <button onClick={() => openEditStep(wf.id, step)} className="p-1 rounded-[6px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Edit2 size={12} /></button>
                                <button onClick={() => deleteStep(step)} className="p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                      <button onClick={() => openAddStep(wf.id, steps.length)} className="mt-3 w-full py-2 border border-dashed border-gray-200 rounded-[10px] text-sm text-gray-400 hover:text-[#002FA7] hover:border-[#002FA7]/40 transition-colors flex items-center justify-center gap-1">
                        <Plus size={14} /> 添加步骤
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Workflow Modal */}
      {showWfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editingWf ? "编辑工作流" : "新增工作流"}</h2>
            <div className="space-y-4">
              <Input label="工作流名称" placeholder="如 内容生产流程" value={wfForm.name} onChange={(e) => setWfForm({ ...wfForm, name: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">简介</label>
                <textarea rows={2} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="简短描述工作流用途…" value={wfForm.description} onChange={(e) => setWfForm({ ...wfForm, description: e.target.value })} />
              </div>
              <Input label="分类标签（可选备注）" placeholder="如 文案写作、数据分析" value={wfForm.category} onChange={(e) => setWfForm({ ...wfForm, category: e.target.value })} />
              {categories.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">关联分类（前台过滤用，可多选）</label>
                  <div className="border border-gray-200 rounded-[12px] p-3 max-h-36 overflow-y-auto space-y-1.5">
                    {categories.map((cat) => {
                      const checked = wfForm.categoryIds.includes(cat.id);
                      return (
                        <label key={cat.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-[#002FA7] w-4 h-4"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? wfForm.categoryIds.filter((id) => id !== cat.id)
                                : [...wfForm.categoryIds, cat.id];
                              setWfForm({ ...wfForm, categoryIds: next });
                            }}
                          />
                          <span className="text-sm text-gray-700">{cat.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400">不选则此工作流不出现在任何分类筛选下（点"全部"时仍可见）</p>
                </div>
              )}
              <Input label="排序（数字越小越靠前）" type="number" value={String(wfForm.sortOrder)} onChange={(e) => setWfForm({ ...wfForm, sortOrder: Number(e.target.value) })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">可见权限</label>
                <select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={wfForm.visibleTo === "all" ? "all" : "custom"} onChange={(e) => setWfForm({ ...wfForm, visibleTo: e.target.value === "all" ? "all" : "" })}>
                  <option value="all">全部用户可见</option>
                  <option value="custom">指定企业码</option>
                </select>
                {wfForm.visibleTo !== "all" && (
                  <input className="w-full h-10 border border-gray-200 rounded-[10px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" placeholder="逗号分隔，如 DEMO,ACME" value={wfForm.visibleTo} onChange={(e) => setWfForm({ ...wfForm, visibleTo: e.target.value })} />
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={wfForm.enabled} onChange={(e) => setWfForm({ ...wfForm, enabled: e.target.checked })} />
                <span className="text-sm text-gray-700">启用</span>
              </label>
              {wfError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{wfError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowWfModal(false)}>取消</Button>
              <Button onClick={handleSaveWf} loading={saving}>{editingWf ? "保存" : "创建"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Step Modal */}
      {showStepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-900 mb-5">{showStepModal.step ? "编辑步骤" : "添加步骤"}</h2>
            <div className="space-y-4">
              <Input label="步骤顺序" type="number" value={String(stepForm.stepOrder)} onChange={(e) => setStepForm({ ...stepForm, stepOrder: Number(e.target.value) })} />
              <Input label="步骤标题" placeholder="如 撰写初稿" value={stepForm.title} onChange={(e) => setStepForm({ ...stepForm, title: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">步骤说明</label>
                <textarea rows={2} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="说明此步骤的操作要点…" value={stepForm.description} onChange={(e) => setStepForm({ ...stepForm, description: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">执行类型</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="execType" value="agent" checked={stepForm.execType === "agent"} onChange={() => setStepForm({ ...stepForm, execType: "agent" })} className="accent-[#002FA7]" />
                    <Bot size={14} className="text-[#002FA7]" /><span className="text-sm">智能体执行</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="execType" value="manual" checked={stepForm.execType === "manual"} onChange={() => setStepForm({ ...stepForm, execType: "manual" })} className="accent-[#002FA7]" />
                    <User size={14} className="text-amber-500" /><span className="text-sm">人工执行</span>
                  </label>
                </div>
              </div>
              {stepForm.execType === "agent" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-700">绑定智能体</label>
                    <select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={stepForm.agentId} onChange={(e) => setStepForm({ ...stepForm, agentId: e.target.value })}>
                      <option value="">不绑定</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}{a.agent_type === "external" ? " [外链]" : ""}</option>
                      ))}
                    </select>
                  </div>
                  <Input label="按钮文案" placeholder="如 进入智能体、打开工具" value={stepForm.buttonText} onChange={(e) => setStepForm({ ...stepForm, buttonText: e.target.value })} />
                </>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={stepForm.enabled} onChange={(e) => setStepForm({ ...stepForm, enabled: e.target.checked })} />
                <span className="text-sm text-gray-700">启用此步骤</span>
              </label>
              {stepError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{stepError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowStepModal(null)}>取消</Button>
              <Button onClick={handleSaveStep} loading={saving}>{showStepModal.step ? "保存" : "添加"}</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
