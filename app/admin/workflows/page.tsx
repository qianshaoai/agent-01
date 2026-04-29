"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  PlusCircle,
  Edit2,
  Trash2,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Bot,
  User,
  Eye,
  Wrench,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Loader2,
  Copy,
  Search,
  X,
  Tag,
  Pencil,
  Check,
  Building2,
  Image as ImageIcon,
} from "lucide-react";

type Agent = { id: string; agent_code: string; name: string; agent_type: string; external_url: string };
type Category = { id: string; name: string; icon_url?: string | null };
type Tenant = { id: string; code: string; name: string; enabled: boolean };
type Dept = { id: string; name: string; tenant_code: string };
type Team = { id: string; name: string; dept_id: string };
type Permission = { scope_type: string; scope_id: string | null };

type WorkflowStep = {
  id: string;
  step_order: number;
  title: string;
  description: string;
  exec_type: "agent" | "manual" | "review" | "external";
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
  permissions?: Permission[];
  workflow_steps: WorkflowStep[];
};

type PermScope = "org" | "dept" | "team";

const EMPTY_WF = {
  name: "",
  description: "",
  category: "",
  sortOrder: 0,
  enabled: true,
  visibleTo: "all",
  categoryIds: [] as string[],
  permScope: "org" as PermScope,
  permIds: [] as string[],
};
const EMPTY_STEP = { title: "", description: "", execType: "agent" as "agent" | "manual" | "review" | "external", agentId: "", buttonText: "进入智能体", enabled: true, stepOrder: 1 };

export default function WorkflowsAdminPage() {
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [allDepts, setAllDepts] = useState<Dept[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [tenantSearch, setTenantSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"workflows" | "categories">("workflows");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 4.27up 阶段一：流程图 / 列表 视图切换，按 workflow.id 维度记忆
  // 4.29up：默认视图改为 list（列表为主，流程图为辅）
  const [viewModeMap, setViewModeMap] = useState<Record<string, "flow" | "list">>({});
  function getViewMode(wfId: string): "flow" | "list" { return viewModeMap[wfId] ?? "list"; }
  function setViewMode(wfId: string, mode: "flow" | "list") {
    setViewModeMap((prev) => ({ ...prev, [wfId]: mode }));
  }
  const [wfSearch, setWfSearch] = useState("");
  const [wfCatFilter, setWfCatFilter] = useState("");
  const [wfVisibleFilter, setWfVisibleFilter] = useState("");
  const [wfStatusFilter, setWfStatusFilter] = useState("");

  // Workflow modal
  const [showWfModal, setShowWfModal] = useState(false);
  const [editingWf, setEditingWf] = useState<Workflow | null>(null);
  const [wfForm, setWfForm] = useState(EMPTY_WF);
  const [wfError, setWfError] = useState("");

  // Step modal
  const [showStepModal, setShowStepModal] = useState<{ workflowId: string; step?: WorkflowStep; insertAfterOrder?: number } | null>(null);
  const [stepForm, setStepForm] = useState<{ title: string; description: string; execType: "agent" | "manual" | "review" | "external"; agentId: string; buttonText: string; enabled: boolean; stepOrder: number }>(EMPTY_STEP);
  const [stepError, setStepError] = useState("");
  const [saving, setSaving] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  function showConfirm(message: string, onConfirm: () => void) { setConfirmDialog({ message, onConfirm }); }

  // Category management state
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");

  // 4.29up：?focus=<wfId>&pageSize=100 跨页定位
  // 关键：lazy initial state 同步解析 URL，避免首次以默认 pageSize 加载导致的 focus 竞态
  const router = useRouter();
  const [focusWfId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("focus");
  });
  const [urlPageSize] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const ps = new URLSearchParams(window.location.search).get("pageSize");
    if (!ps) return null;
    const n = parseInt(ps);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [highlightedWfId, setHighlightedWfId] = useState<string | null>(null);
  const focusFiredRef = useRef(false);

  async function load() {
    setLoading(true);
    try {
      const wfPs = urlPageSize && urlPageSize > 0 ? `?pageSize=${urlPageSize}` : "";
      const [wr, ar, cr, tr, dr, teamsR] = await Promise.all([
        fetch(`/api/admin/workflows${wfPs}`).then((r) => r.json()).then(d => d.data ?? d),
        // 4.27up 阶段一：显式 pageSize=100（接口默认 50、上限 100）
        // 避免流程图节点把"不在第一页的智能体"误判为已删除。
        // > 100 智能体的场景作为已知短板，留待阶段二独立评估专用候选接口。
        fetch("/api/admin/agents?pageSize=100").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/wf-categories").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/tenants").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/departments").then((r) => r.json()).then(d => d.data ?? d).catch(() => []),
        fetch("/api/admin/teams").then((r) => r.json()).then(d => d.data ?? d).catch(() => []),
      ]);
      setWorkflows(Array.isArray(wr) ? wr : []);
      setAgents(Array.isArray(ar) ? ar : []);
      setCategories(Array.isArray(cr) ? cr : []);
      setTenants(Array.isArray(tr) ? tr : []);
      setAllDepts(Array.isArray(dr) ? dr : []);
      setAllTeams(Array.isArray(teamsR) ? teamsR : []);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }

  // URL 已通过 lazy initial state 同步初始化，load 直接用对的 pageSize
  useEffect(() => { load(); }, []);

  // focus 高亮：数据加载完成后展开 + 滚动 + ring 1.5s
  useEffect(() => {
    if (!focusWfId || loading || focusFiredRef.current) return;
    if (workflows.length === 0) return;
    focusFiredRef.current = true;
    const target = workflows.find((w) => w.id === focusWfId);
    if (!target) {
      toast("目标工作流不在当前页，请翻页查找");
      return;
    }
    // 自动展开（页面只允许同时展开一条）
    setExpandedId(target.id);
    setHighlightedWfId(target.id);
    setTimeout(() => {
      const el = document.querySelector(`[data-wf-card="${target.id}"]`);
      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
    setTimeout(() => setHighlightedWfId(null), 1500);
  }, [focusWfId, loading, workflows, toast]);

  // ── Workflow CRUD ──────────────────────────────────────────────
  function openAddWf() { setEditingWf(null); setWfForm(EMPTY_WF); setWfError(""); setShowWfModal(true); }
  function openEditWf(wf: Workflow) {
    setEditingWf(wf);
    // 从权限规则还原 permScope / permIds
    const rules = wf.permissions ?? [];
    const firstType = (rules[0]?.scope_type as PermScope) ?? "org";
    const validScope: PermScope = (["org", "dept", "team"].includes(firstType) ? firstType : "org") as PermScope;
    const permIds = rules
      .filter((r) => r.scope_type === validScope)
      .map((r) => r.scope_id ?? "")
      .filter(Boolean);
    setWfForm({
      name: wf.name,
      description: wf.description,
      category: wf.category,
      sortOrder: wf.sort_order,
      enabled: wf.enabled,
      visibleTo: wf.visible_to,
      categoryIds: wf.categoryIds ?? [],
      permScope: validScope,
      permIds,
    });
    setWfError(""); setShowWfModal(true);
  }

  async function handleSaveWf() {
    setWfError("");
    if (!wfForm.name.trim()) { setWfError("请填写工作流名称"); return; }
    // custom 模式下必须至少选一项
    if (wfForm.visibleTo === "custom" && wfForm.permIds.length === 0) {
      setWfError("请至少选择一个可见对象");
      return;
    }
    setSaving(true);
    try {
      // 生成 permissions 数组（custom 模式才有）
      const permissions = wfForm.visibleTo === "custom"
        ? wfForm.permIds.map((scopeId) => ({ scope_type: wfForm.permScope, scope_id: scopeId }))
        : [];
      const body = {
        name: wfForm.name,
        description: wfForm.description,
        category: wfForm.category,
        sortOrder: wfForm.sortOrder,
        enabled: wfForm.enabled,
        visibleTo: wfForm.visibleTo,
        categoryIds: wfForm.categoryIds,
        permissions,
      };
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

  function duplicateWf(wf: Workflow) {
    showConfirm(`确认复制工作流「${wf.name}」？将连同所有步骤一起复制。`, async () => {
      await fetch(`/api/admin/workflows/${wf.id}/duplicate`, { method: "POST" });
      load(); toast("工作流已复制");
    });
  }

  function deleteWf(wf: Workflow) {
    showConfirm(`确认删除工作流「${wf.name}」？步骤也会一并删除。`, async () => {
      await fetch(`/api/admin/workflows/${wf.id}`, { method: "DELETE" });
      load(); toast("工作流已删除");
    });
  }

  // ── Step CRUD ──────────────────────────────────────────────────
  function openAddStep(workflowId: string, currentStepCount: number) {
    setShowStepModal({ workflowId });
    setStepForm({ ...EMPTY_STEP, stepOrder: currentStepCount + 1 });
    setStepError("");
  }
  // 在指定位置插入（insertAfterOrder: 插入在第几步之后，0=最前面）
  function openInsertStep(workflowId: string, insertAfterOrder: number) {
    setShowStepModal({ workflowId, insertAfterOrder });
    setStepForm({ ...EMPTY_STEP, stepOrder: insertAfterOrder + 1 });
    setStepError("");
  }
  function openEditStep(workflowId: string, step: WorkflowStep) {
    setShowStepModal({ workflowId, step });
    setStepForm({ title: step.title, description: step.description, execType: step.exec_type, agentId: step.agent_id ?? "", buttonText: step.button_text, enabled: step.enabled, stepOrder: step.step_order });
    setStepError("");
  }

  // 保存后对工作流所有步骤重新顺序编号（1, 2, 3...）
  async function renumberSteps(workflowId: string, newStepId?: string) {
    const wf = workflows.find(w => w.id === workflowId);
    const steps = [...(wf?.workflow_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
    // 如果是插入，新步骤已用 insertAfterOrder+1，这里按当前顺序重排
    // 先 reload 拿最新列表再重排
    const res = await fetch(`/api/admin/workflows`).then(r => r.json()).then(d => d.data ?? d).catch(() => []);
    const fresh = (Array.isArray(res) ? res : []).find((w: { id: string }) => w.id === workflowId);
    const freshSteps: WorkflowStep[] = fresh?.workflow_steps
      ? [...fresh.workflow_steps].sort((a: WorkflowStep, b: WorkflowStep) => a.step_order - b.step_order)
      : steps;
    // 如果有 insertAfterOrder，把新步骤放到正确位置后重排
    const insertAfterOrder = showStepModal?.insertAfterOrder;
    if (insertAfterOrder !== undefined && newStepId) {
      const newStep = freshSteps.find(s => s.id === newStepId);
      if (newStep) {
        const others = freshSteps.filter(s => s.id !== newStepId);
        const reordered = [
          ...others.slice(0, insertAfterOrder),
          newStep,
          ...others.slice(insertAfterOrder),
        ];
        await Promise.all(reordered.map((s, i) =>
          s.step_order !== i + 1
            ? fetch(`/api/admin/workflow-steps/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepOrder: i + 1 }) })
            : Promise.resolve()
        ));
        return;
      }
    }
    // 普通重排：按当前顺序重新编 1,2,3
    await Promise.all(freshSteps.map((s, i) =>
      s.step_order !== i + 1
        ? fetch(`/api/admin/workflow-steps/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepOrder: i + 1 }) })
        : Promise.resolve()
    ));
  }

  async function handleSaveStep() {
    setStepError("");
    if (!stepForm.title.trim()) { setStepError("请填写步骤标题"); return; }
    if (!showStepModal) return;
    setSaving(true);
    try {
      const body = { stepOrder: stepForm.stepOrder, title: stepForm.title, description: stepForm.description, execType: stepForm.execType, agentId: stepForm.execType === "agent" ? (stepForm.agentId || null) : null, buttonText: stepForm.buttonText, enabled: stepForm.enabled };
      const res = showStepModal.step
        ? await fetch(`/api/admin/workflow-steps/${showStepModal.step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/workflows/${showStepModal.workflowId}/steps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setStepError(data.error ?? "保存失败"); return; }
      const parentId = showStepModal.workflowId;
      const newStepId = !showStepModal.step ? data.id : undefined;
      setShowStepModal(null);
      setExpandedId(parentId);
      await load();
      if (newStepId || showStepModal?.insertAfterOrder !== undefined) {
        await renumberSteps(parentId, newStepId);
        await load();
      }
    } finally { setSaving(false); }
  }

  function deleteStep(step: WorkflowStep) {
    showConfirm(`确认删除步骤「${step.title}」？`, async () => {
      const wf = workflows.find(w => w.workflow_steps?.some(s => s.id === step.id));
      await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "DELETE" });
      await load();
      if (wf) await renumberSteps(wf.id);
      await load();
      toast("步骤已删除");
    });
  }

  async function toggleStepEnabled(step: WorkflowStep) {
    await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !step.enabled }) });
    load();
  }

  // 4.27up 阶段三（第一轮）：上移 / 下移按钮
  // 严格按方案 §5.2 失败处理：
  //   - 第一次 PATCH 失败 → toast "排序失败"，无须补偿
  //   - 第二次 PATCH 失败 → 启动补偿写回（反向 PATCH 把第一次的 step_order 写回原值），
  //     无论补偿是否成功，强制 load() 重拉
  //   - 补偿成功："排序未生效，已恢复原顺序"
  //   - 补偿失败："排序可能未完全保存，请刷新确认"
  //   - 补偿只尝试一次，不重试
  // 操作期间相邻按钮禁用，由 moving 控制；同时记录方向以便正确按钮上显示 loading
  const [moving, setMoving] = useState<{ stepId: string; direction: "up" | "down" } | null>(null);

  async function moveStep(step: WorkflowStep, direction: "up" | "down") {
    if (moving) return; // 已有进行中的排序操作
    const wf = workflows.find((w) => w.workflow_steps?.some((s) => s.id === step.id));
    if (!wf) return;
    const sortedSteps = [...(wf.workflow_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
    const idx = sortedSteps.findIndex((s) => s.id === step.id);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sortedSteps.length) return;

    const a = step;
    const b = sortedSteps[targetIdx];
    const aOldOrder = a.step_order;
    const bOldOrder = b.step_order;

    setMoving({ stepId: step.id, direction });

    // 乐观更新：在前端先把两个 step_order 交换
    setWorkflows((prev) =>
      prev.map((w) => ({
        ...w,
        workflow_steps: (w.workflow_steps ?? []).map((s) => {
          if (s.id === a.id) return { ...s, step_order: bOldOrder };
          if (s.id === b.id) return { ...s, step_order: aOldOrder };
          return s;
        }),
      }))
    );

    // 第一次 PATCH：把 a 的 step_order 改成 b 原值
    let r1Ok = false;
    try {
      const r1 = await fetch(`/api/admin/workflow-steps/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepOrder: bOldOrder }),
      });
      r1Ok = r1.ok;
    } catch (e) {
      console.error("[moveStep r1]", e);
      r1Ok = false;
    }
    if (!r1Ok) {
      // 第一次失败（HTTP 非 2xx 或网络异常）→ 数据库未变更，回滚前端 state，提示
      setWorkflows((prev) =>
        prev.map((w) => ({
          ...w,
          workflow_steps: (w.workflow_steps ?? []).map((s) => {
            if (s.id === a.id) return { ...s, step_order: aOldOrder };
            if (s.id === b.id) return { ...s, step_order: bOldOrder };
            return s;
          }),
        }))
      );
      toast("排序失败");
      setMoving(null);
      return;
    }

    // 第二次 PATCH：把 b 的 step_order 改成 a 原值
    // 注意：HTTP 非 2xx 与网络 throw 都视为"第二次失败"，必须走补偿 + load() 重拉
    let r2Ok = false;
    try {
      const r2 = await fetch(`/api/admin/workflow-steps/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepOrder: aOldOrder }),
      });
      r2Ok = r2.ok;
    } catch (e) {
      console.error("[moveStep r2]", e);
      r2Ok = false;
    }
    if (r2Ok) {
      setMoving(null);
      return; // 全部成功
    }

    // 第二次失败 → 局部成功（a 已落库为 bOldOrder，但 a 和 b 现在 step_order 相同）
    // 启动补偿：把 a 写回原值；补偿只尝试一次
    let compensated = false;
    try {
      const rc = await fetch(`/api/admin/workflow-steps/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepOrder: aOldOrder }),
      });
      compensated = rc.ok;
    } catch (e) {
      console.error("[moveStep compensate]", e);
      compensated = false;
    }

    // 无论补偿成功与否，强制重拉
    try {
      await load();
    } catch (e) {
      console.error("[moveStep load]", e);
    }
    toast(compensated ? "排序未生效，已恢复原顺序" : "排序可能未完全保存，请刷新确认");
    setMoving(null);
  }

  // 4.27up 阶段二：节点内快捷绑定智能体
  // 必须同时传 execType 和 agentId（见接口逻辑：只传 agentId 时 exec_type 为 undefined，会被改写成 null）
  async function bindAgentToStep(step: WorkflowStep, agentId: string) {
    const prevAgentId = step.agent_id;
    // 乐观更新
    setWorkflows((prev) =>
      prev.map((wf) => ({
        ...wf,
        workflow_steps: (wf.workflow_steps ?? []).map((s) =>
          s.id === step.id ? { ...s, agent_id: agentId } : s
        ),
      }))
    );
    try {
      const res = await fetch(`/api/admin/workflow-steps/${step.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execType: "agent", agentId }),
      });
      if (!res.ok) throw new Error("PATCH failed");
    } catch (e) {
      // 回滚到原 agent_id
      setWorkflows((prev) =>
        prev.map((wf) => ({
          ...wf,
          workflow_steps: (wf.workflow_steps ?? []).map((s) =>
            s.id === step.id ? { ...s, agent_id: prevAgentId } : s
          ),
        }))
      );
      console.error("[bindAgentToStep]", e);
      toast("绑定智能体失败，请重试");
    }
  }

  const getAgent = (agentId: string | null): Agent | null => {
    if (!agentId) return null;
    return agents.find((a) => a.id === agentId) ?? null;
  };

  // ── WF Category CRUD ──────────────────────────────────────────
  async function addWfCategory() {
    if (!newCatName.trim()) return;
    await fetch("/api/admin/wf-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCatName.trim() }) });
    setNewCatName(""); load();
  }

  async function saveEditWfCat(id: string) {
    if (!editingCatName.trim()) return;
    await fetch(`/api/admin/wf-categories/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingCatName.trim() }) });
    setEditingCatId(null); setEditingCatName(""); load();
  }

  function deleteWfCat(cat: Category) {
    showConfirm(`确认删除分类「${cat.name}」？`, async () => {
      const res = await fetch(`/api/admin/wf-categories/${cat.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); alert(d.error ?? "删除失败"); return; }
      load();
    });
  }

  async function handleWfCatIcon(catId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/wf-categories/${catId}/icon`, { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, icon_url: data.url } : c));
    } else {
      const d = await res.json();
      alert(d.error ?? "图标上传失败");
    }
    e.target.value = "";
  }

  function removeWfCatIcon(catId: string) {
    showConfirm("确认删除此分类的图标？", async () => {
      const res = await fetch(`/api/admin/wf-categories/${catId}/icon`, { method: "DELETE" });
      if (res.ok) {
        setCategories((prev) => prev.map((c) => c.id === catId ? { ...c, icon_url: null } : c));
      }
    });
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<GitBranch size={20} />}
          title="工作流管理"
          subtitle="管理工作流、步骤与分类"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {workflows.length} 个</span>}
          actions={
            <>
              <div className="flex gap-1 p-1 bg-gray-100/70 rounded-[10px]">
                {(["workflows", "categories"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${activeTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                    {tab === "workflows" ? "工作流列表" : "分类管理"}
                  </button>
                ))}
              </div>
              {activeTab === "workflows" && <Button onClick={openAddWf} className="gap-2"><Plus size={16} /> 新增工作流</Button>}
            </>
          }
        />

        {activeTab === "workflows" && <>

        {/* 筛选栏 */}
        <Card padding="md" className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full h-10 border border-gray-200 rounded-[10px] pl-9 pr-3 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" placeholder="搜索工作流名称…" value={wfSearch} onChange={e => setWfSearch(e.target.value)} />
          </div>
          <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={wfCatFilter} onChange={e => setWfCatFilter(e.target.value)}>
            <option value="">全部分类</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={wfVisibleFilter} onChange={e => setWfVisibleFilter(e.target.value)}>
            <option value="">全部可见范围</option>
            <option value="all">全部用户</option>
            <option value="org_only">仅组织用户</option>
            <option value="personal_only">仅个人用户</option>
            <option value="custom:org">指定组织可见</option>
            <option value="custom:dept">指定部门可见</option>
            <option value="custom:team">指定小组可见</option>
          </select>
          <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={wfStatusFilter} onChange={e => setWfStatusFilter(e.target.value)}>
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </select>
          {(wfSearch || wfCatFilter || wfVisibleFilter || wfStatusFilter) && (
            <button onClick={() => { setWfSearch(""); setWfCatFilter(""); setWfVisibleFilter(""); setWfStatusFilter(""); }} className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2">
              <X size={13} /> 清除
            </button>
          )}
        </Card>

        {loading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white rounded-[16px] animate-pulse" />)}</div>
        ) : (() => {
          const filteredWorkflows = workflows.filter(wf => {
            if (wfSearch && !wf.name.toLowerCase().includes(wfSearch.toLowerCase())) return false;
            if (wfCatFilter && !(wf.categoryIds ?? []).includes(wfCatFilter)) return false;
            if (wfStatusFilter === "enabled" && !wf.enabled) return false;
            if (wfStatusFilter === "disabled" && wf.enabled) return false;
            if (wfVisibleFilter === "all" && wf.visible_to !== "all") return false;
            if (wfVisibleFilter === "org_only" && wf.visible_to !== "org_only") return false;
            if (wfVisibleFilter === "personal_only" && wf.visible_to !== "personal_only") return false;
            if (wfVisibleFilter.startsWith("custom:")) {
              if (wf.visible_to !== "custom") return false;
              const targetScope = wfVisibleFilter.split(":")[1];
              const firstType = wf.permissions?.[0]?.scope_type;
              if (firstType !== targetScope) return false;
            }
            return true;
          });
          return filteredWorkflows.length === 0 ? (
          <Card padding="lg" className="py-16 text-center text-gray-400">
            <GitBranch size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm">{workflows.length === 0 ? "暂无工作流，点击右上角新增" : "没有符合筛选条件的工作流"}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredWorkflows.map((wf) => {
              const isExpanded = expandedId === wf.id;
              const steps = [...(wf.workflow_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
              return (
                <div
                  key={wf.id}
                  data-wf-card={wf.id}
                  className={`card overflow-hidden transition-all ${
                    highlightedWfId === wf.id ? "ring-2 ring-[#002FA7] ring-offset-2" : ""
                  }`}
                >
                  {/* Workflow header */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <button onClick={() => setExpandedId(isExpanded ? null : wf.id)} className="p-1 rounded-[8px] hover:bg-gray-100 text-gray-400">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{wf.name}</p>
                        {(wf.categoryIds ?? []).map((cid) => {
                          const cat = categories.find((c) => c.id === cid);
                          if (!cat) return null;
                          return (
                            <span key={cid} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">
                              {/* 小图标（<20px），next/image 优化收益低 */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {cat.icon_url ? <img src={cat.icon_url} alt="" className="w-3.5 h-3.5 rounded-[3px] object-contain" /> : <Tag size={10} />}
                              {cat.name}
                            </span>
                          );
                        })}
                        {wf.visible_to === "org_only" && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">仅组织用户</span>}
                        {wf.visible_to === "personal_only" && <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">仅个人用户</span>}
                        {wf.visible_to === "custom" && (() => {
                          const rules = wf.permissions ?? [];
                          const firstType = rules[0]?.scope_type;
                          const label = firstType === "dept" ? "指定部门可见"
                                      : firstType === "team" ? "指定小组可见"
                                      : "指定组织可见";
                          const count = rules.length;
                          return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium" title={`${label}（共 ${count} 项）`}>{label}</span>;
                        })()}
                        {/* 兼容旧数据：visible_to 不是任何预设也不是 custom，走旧的逗号分隔组织码格式 */}
                        {wf.visible_to && wf.visible_to !== "all" && wf.visible_to !== "org_only" && wf.visible_to !== "personal_only" && wf.visible_to !== "custom" && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium" title={`指定组织可见：${wf.visible_to}`}>指定组织可见</span>}
                        {!wf.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">已停用</span>}
                      </div>
                      {wf.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{wf.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-gray-400 mr-2">{steps.length} 个步骤</span>
                      <button onClick={() => toggleWfEnabled(wf)} className={`p-1.5 rounded-[8px] transition-colors ${wf.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`} title={wf.enabled ? "停用" : "启用"}>
                        {wf.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                      </button>
                      <button onClick={() => duplicateWf(wf)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="复制工作流" aria-label="复制工作流"><Copy size={14} /></button>
                      <button onClick={() => openEditWf(wf)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑" aria-label="编辑"><Edit2 size={14} /></button>
                      <button onClick={() => deleteWf(wf)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除" aria-label="删除"><Trash2 size={14} /></button>
                    </div>
                  </div>

                  {/* Steps */}
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 pb-4 pt-3">
                      {/* 4.27up 阶段一：视图切换 Tab */}
                      <div className="flex items-center gap-1 mb-3 p-0.5 bg-gray-100 rounded-[8px] w-fit">
                        {(["list", "flow"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setViewMode(wf.id, mode)}
                            className={`px-3 py-1 text-xs rounded-[6px] transition-colors ${
                              getViewMode(wf.id) === mode
                                ? "bg-white text-[#002FA7] shadow-sm font-medium"
                                : "text-gray-500 hover:text-gray-700"
                            }`}
                          >
                            {mode === "flow" ? "流程图" : "列表"}
                          </button>
                        ))}
                      </div>

                      {getViewMode(wf.id) === "flow" ? (
                        <WorkflowFlowView
                          wfId={wf.id}
                          steps={steps}
                          agents={agents}
                          getAgent={getAgent}
                          openInsertStep={openInsertStep}
                          openEditStep={openEditStep}
                          deleteStep={deleteStep}
                          toggleStepEnabled={toggleStepEnabled}
                          bindAgentToStep={bindAgentToStep}
                          moveStep={moveStep}
                          moving={moving}
                          openAddStep={openAddStep}
                        />
                      ) : (
                      <>
                      <div className="space-y-2">
                        {steps.length === 0 ? (
                          <p className="text-sm text-gray-400 py-3 text-center">暂无步骤</p>
                        ) : (
                          steps.map((step, idx) => (
                            <div key={step.id}>
                              {/* 在每个步骤前插入按钮（第一个步骤前） */}
                              {idx === 0 && (
                                <button onClick={() => openInsertStep(wf.id, 0)} className="w-full flex items-center gap-1 py-0.5 text-xs text-gray-300 hover:text-[#002FA7] transition-colors group mb-1">
                                  <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                                  <PlusCircle size={12} />
                                  <span>插入</span>
                                  <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                                </button>
                              )}
                            <div className={`flex items-start gap-3 p-3 rounded-[12px] ${step.enabled ? "bg-gray-50" : "bg-gray-50/50 opacity-60"}`}>
                              <GripVertical size={14} className="text-gray-300 mt-0.5 shrink-0" />
                              <div className="w-6 h-6 rounded-full bg-[#002FA7]/10 text-[#002FA7] text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-gray-800">{step.title}</p>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                                    step.exec_type === "agent" ? "bg-blue-50 text-blue-600" :
                                    step.exec_type === "manual" ? "bg-amber-50 text-amber-600" :
                                    step.exec_type === "review" ? "bg-purple-50 text-purple-600" :
                                    "bg-gray-50 text-gray-600"
                                  }`}>
                                    {step.exec_type === "agent" && <><Bot size={11} />智能体</>}
                                    {step.exec_type === "manual" && <><User size={11} />人工执行</>}
                                    {step.exec_type === "review" && <><Eye size={11} />人工审核</>}
                                    {step.exec_type === "external" && <><Wrench size={11} />外部工具</>}
                                  </span>
                                </div>
                                {step.description && <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>}
                                {step.exec_type === "agent" && step.agent_id && (() => {
                                  const boundAgent = getAgent(step.agent_id);
                                  if (!boundAgent) {
                                    return (
                                      <p className="text-xs text-gray-400 mt-1">
                                        绑定：{step.agent_id}
                                      </p>
                                    );
                                  }
                                  return (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(`/admin/agents?focus=${boundAgent.id}&pageSize=100`);
                                      }}
                                      className="text-xs text-[#002FA7] hover:underline mt-1 flex items-center gap-1"
                                      title="跳转到智能体管理"
                                    >
                                      {boundAgent.agent_type === "external" ? <ExternalLink size={10} /> : <Bot size={10} />}
                                      <span className="truncate max-w-[260px]">绑定：{boundAgent.name}</span>
                                    </button>
                                  );
                                })()}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => toggleStepEnabled(step)} className={`p-1 rounded-[6px] transition-colors text-xs ${step.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`}>
                                  {step.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                </button>
                                <button onClick={() => openEditStep(wf.id, step)} className="p-1 rounded-[6px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Edit2 size={12} /></button>
                                <button onClick={() => deleteStep(step)} className="p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                              </div>
                            </div>
                            {/* 每个步骤后面的插入按钮 */}
                            <button onClick={() => openInsertStep(wf.id, idx + 1)} className="w-full flex items-center gap-1 py-0.5 text-xs text-gray-300 hover:text-[#002FA7] transition-colors group mt-1">
                              <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                              <PlusCircle size={12} />
                              <span>插入</span>
                              <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                            </button>
                            </div>
                          ))
                        )}
                      </div>
                      <button onClick={() => openAddStep(wf.id, steps.length)} className="mt-3 w-full py-2 border border-dashed border-gray-200 rounded-[10px] text-sm text-gray-400 hover:text-[#002FA7] hover:border-[#002FA7]/40 transition-colors flex items-center justify-center gap-1">
                        <Plus size={14} /> 添加步骤
                      </button>
                      </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
        })()}

        </>}

        {/* 分类管理 Tab */}
        {activeTab === "categories" && (
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <input
                className="flex-1 h-10 border border-gray-200 rounded-[10px] px-4 text-sm focus:outline-none focus:border-[#002FA7]"
                placeholder="新分类名称…"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addWfCategory()}
              />
              <Button size="sm" onClick={addWfCategory} className="gap-1"><Plus size={14} /> 添加</Button>
            </div>
            <div className="space-y-2">
              {categories.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">暂无分类，在上方输入名称后回车或点击添加</p>
              ) : categories.map((cat) => (
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
                          if (e.key === "Enter") saveEditWfCat(cat.id);
                          if (e.key === "Escape") { setEditingCatId(null); setEditingCatName(""); }
                        }}
                      />
                      <button onClick={() => saveEditWfCat(cat.id)} className="p-1.5 rounded-[6px] bg-[#002FA7] text-white hover:bg-[#002FA7]/90 transition-colors" title="确认" aria-label="确认"><Check size={13} /></button>
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
                          <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={(e) => handleWfCatIcon(cat.id, e)} />
                          <ImageIcon size={13} />
                        </label>
                        {cat.icon_url && (
                          <button onClick={() => removeWfCatIcon(cat.id)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除图标" aria-label="删除图标"><X size={13} /></button>
                        )}
                        <button onClick={() => { setEditingCatId(cat.id); setEditingCatName(cat.name); }} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="编辑" aria-label="编辑"><Pencil size={13} /></button>
                        <button onClick={() => deleteWfCat(cat)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除" aria-label="删除"><Trash2 size={13} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>

      {/* Workflow Modal */}
      {showWfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-900 mb-5">{editingWf ? "编辑工作流" : "新增工作流"}</h2>
            <div className="space-y-4">
              <Input label="工作流名称" placeholder="如 内容生产流程" value={wfForm.name} onChange={(e) => setWfForm({ ...wfForm, name: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">简介</label>
                <textarea rows={2} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="简短描述工作流用途…" value={wfForm.description} onChange={(e) => setWfForm({ ...wfForm, description: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">所属分类（可多选）</label>
                {categories.length === 0 ? (
                  <p className="text-xs text-gray-400">暂无分类，请先在「分类管理」Tab 中创建</p>
                ) : (
                  <>
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
                    <p className="text-xs text-gray-400">不选则此工作流不出现在任何分类筛选下</p>
                  </>
                )}
              </div>
              <Input label="排序（数字越小越靠前）" type="number" value={String(wfForm.sortOrder)} onChange={(e) => setWfForm({ ...wfForm, sortOrder: Number(e.target.value) })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">可见权限</label>
                <select
                  className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]"
                  value={wfForm.visibleTo === "custom" ? `custom:${wfForm.permScope}` : wfForm.visibleTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTenantSearch("");
                    if (v.startsWith("custom:")) {
                      const scope = v.split(":")[1] as PermScope;
                      // 切换 scope 类型时清空已选项，避免类型混淆
                      setWfForm({ ...wfForm, visibleTo: "custom", permScope: scope, permIds: [] });
                    } else {
                      setWfForm({ ...wfForm, visibleTo: v, permIds: [] });
                    }
                  }}
                >
                  <option value="all">全部用户可见</option>
                  <option value="org_only">仅组织用户可见</option>
                  <option value="personal_only">仅个人用户可见</option>
                  <option value="custom:org">指定组织可见</option>
                  <option value="custom:dept">指定部门可见</option>
                  <option value="custom:team">指定小组可见</option>
                </select>

                {/* custom 模式下根据 permScope 展示对应 picker */}
                {wfForm.visibleTo === "custom" && wfForm.permScope === "org" && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      className="w-full h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                      placeholder="搜索组织名称或组织码…"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-44 overflow-y-auto space-y-1.5">
                      {tenants
                        .filter((t) => {
                          const q = tenantSearch.toLowerCase();
                          return !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q);
                        })
                        .map((t) => {
                          const checked = wfForm.permIds.includes(t.code);
                          return (
                            <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                className="accent-[#002FA7] w-4 h-4"
                                checked={checked}
                                onChange={() => {
                                  const next = checked
                                    ? wfForm.permIds.filter((c) => c !== t.code)
                                    : [...wfForm.permIds, t.code];
                                  setWfForm({ ...wfForm, permIds: next });
                                }}
                              />
                              <span className="text-sm text-gray-700">{t.name}</span>
                              <span className="text-xs text-gray-400 font-mono">{t.code}</span>
                              {!t.enabled && <span className="text-xs text-red-400">已停用</span>}
                            </label>
                          );
                        })}
                      {tenants.length === 0 && <p className="text-xs text-gray-400 text-center py-2">暂无组织</p>}
                    </div>
                    <p className="text-xs text-gray-400">已选 {wfForm.permIds.length} 个组织</p>
                  </div>
                )}

                {wfForm.visibleTo === "custom" && wfForm.permScope === "dept" && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      className="w-full h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                      placeholder="搜索组织或部门名称…"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-60 overflow-y-auto">
                      {(() => {
                        const q = tenantSearch.toLowerCase();
                        // 按组织分组
                        const groups = tenants
                          .map((t) => {
                            const depts = allDepts.filter((d) => d.tenant_code === t.code);
                            const filteredDepts = q
                              ? depts.filter((d) => d.name.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
                              : depts;
                            return { tenant: t, depts: filteredDepts };
                          })
                          .filter((g) => g.depts.length > 0);
                        if (groups.length === 0) {
                          return <p className="text-xs text-gray-400 text-center py-2">暂无匹配部门</p>;
                        }
                        return groups.map((g) => (
                          <div key={g.tenant.id} className="mb-3 last:mb-0">
                            <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-gray-100">
                              <Building2 size={13} className="text-[#002FA7] shrink-0" />
                              <span className="text-[12px] font-semibold text-gray-700">{g.tenant.name}</span>
                              <span className="text-[11px] text-gray-400 font-mono">{g.tenant.code}</span>
                            </div>
                            <div className="space-y-1 pl-1">
                              {g.depts.map((d) => {
                                const checked = wfForm.permIds.includes(d.id);
                                return (
                                  <label key={d.id} className="flex items-center gap-2 cursor-pointer pl-4 py-0.5">
                                    <input
                                      type="checkbox"
                                      className="accent-[#002FA7] w-4 h-4"
                                      checked={checked}
                                      onChange={() => {
                                        const next = checked
                                          ? wfForm.permIds.filter((x) => x !== d.id)
                                          : [...wfForm.permIds, d.id];
                                        setWfForm({ ...wfForm, permIds: next });
                                      }}
                                    />
                                    <span className="text-sm text-gray-700">{d.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                    <p className="text-xs text-gray-400">已选 {wfForm.permIds.length} 个部门</p>
                  </div>
                )}

                {wfForm.visibleTo === "custom" && wfForm.permScope === "team" && (
                  <div className="flex flex-col gap-1.5">
                    <input
                      className="w-full h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]"
                      placeholder="搜索组织/部门/小组名称…"
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-72 overflow-y-auto">
                      {(() => {
                        const q = tenantSearch.toLowerCase();
                        const groups = tenants
                          .map((t) => {
                            const depts = allDepts.filter((d) => d.tenant_code === t.code);
                            const deptWithTeams = depts
                              .map((d) => {
                                const teams = allTeams.filter((tm) => tm.dept_id === d.id);
                                const filteredTeams = q
                                  ? teams.filter((tm) =>
                                      tm.name.toLowerCase().includes(q) ||
                                      d.name.toLowerCase().includes(q) ||
                                      t.name.toLowerCase().includes(q) ||
                                      t.code.toLowerCase().includes(q)
                                    )
                                  : teams;
                                return { dept: d, teams: filteredTeams };
                              })
                              .filter((dt) => dt.teams.length > 0);
                            return { tenant: t, deptWithTeams };
                          })
                          .filter((g) => g.deptWithTeams.length > 0);
                        if (groups.length === 0) {
                          return <p className="text-xs text-gray-400 text-center py-2">暂无匹配小组</p>;
                        }
                        return groups.map((g) => (
                          <div key={g.tenant.id} className="mb-3 last:mb-0">
                            <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-gray-100">
                              <Building2 size={13} className="text-[#002FA7] shrink-0" />
                              <span className="text-[12px] font-semibold text-gray-700">{g.tenant.name}</span>
                              <span className="text-[11px] text-gray-400 font-mono">{g.tenant.code}</span>
                            </div>
                            <div className="space-y-2 pl-1">
                              {g.deptWithTeams.map(({ dept, teams }) => (
                                <div key={dept.id}>
                                  <div className="flex items-center gap-1.5 pl-3 py-0.5">
                                    <span className="text-[11px] font-medium text-gray-500">{dept.name}</span>
                                  </div>
                                  <div className="space-y-0.5">
                                    {teams.map((tm) => {
                                      const checked = wfForm.permIds.includes(tm.id);
                                      return (
                                        <label key={tm.id} className="flex items-center gap-2 cursor-pointer pl-8 py-0.5">
                                          <input
                                            type="checkbox"
                                            className="accent-[#002FA7] w-4 h-4"
                                            checked={checked}
                                            onChange={() => {
                                              const next = checked
                                                ? wfForm.permIds.filter((x) => x !== tm.id)
                                                : [...wfForm.permIds, tm.id];
                                              setWfForm({ ...wfForm, permIds: next });
                                            }}
                                          />
                                          <span className="text-sm text-gray-700">{tm.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                    <p className="text-xs text-gray-400">已选 {wfForm.permIds.length} 个小组</p>
                  </div>
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
              <Input label="步骤顺序" type="number" min="1" value={String(stepForm.stepOrder)} onChange={(e) => setStepForm({ ...stepForm, stepOrder: Math.max(1, Number(e.target.value)) })} />
              <Input label="步骤标题" placeholder="如 撰写初稿" value={stepForm.title} onChange={(e) => setStepForm({ ...stepForm, title: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">步骤说明</label>
                <textarea rows={2} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="说明此步骤的操作要点…" value={stepForm.description} onChange={(e) => setStepForm({ ...stepForm, description: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">执行类型</label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-[8px] hover:bg-gray-50">
                    <input type="radio" name="execType" value="agent" checked={stepForm.execType === "agent"} onChange={() => setStepForm({ ...stepForm, execType: "agent" })} className="accent-[#002FA7]" />
                    <Bot size={14} className="text-[#002FA7]" /><span className="text-sm">智能体执行</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-[8px] hover:bg-gray-50">
                    <input type="radio" name="execType" value="manual" checked={stepForm.execType === "manual"} onChange={() => setStepForm({ ...stepForm, execType: "manual" })} className="accent-[#002FA7]" />
                    <User size={14} className="text-amber-500" /><span className="text-sm">人工执行</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-[8px] hover:bg-gray-50">
                    <input type="radio" name="execType" value="review" checked={stepForm.execType === "review"} onChange={() => setStepForm({ ...stepForm, execType: "review" })} className="accent-[#002FA7]" />
                    <User size={14} className="text-purple-500" /><span className="text-sm">人工审核</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-[8px] hover:bg-gray-50">
                    <input type="radio" name="execType" value="external" checked={stepForm.execType === "external"} onChange={() => setStepForm({ ...stepForm, execType: "external" })} className="accent-[#002FA7]" />
                    <span className="text-green-500 text-sm">⚡</span><span className="text-sm">其他（外部AI工具）</span>
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

      {/* 确认弹窗 */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="确认操作">
          <div className="bg-white rounded-[16px] shadow-2xl w-full max-w-sm p-6">
            <p className="text-sm text-gray-700 leading-relaxed mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDialog(null)}>取消</Button>
              <Button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}>确认</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4.27up 阶段一：流程图视图（私有组件，同文件维护）
// 严格约束：
//   - 不发起任何额外请求；绑定智能体名称必须复用父组件传入的 getAgent
//   - 不改任何 API、不改 schema、不引入新依赖
//   - 节点显示步骤序号、标题、执行类型徽章、绑定智能体、启停状态、编辑/删除
//   - 节点之间提供"+ 插入"按钮，复用父组件 openInsertStep
//   - 异常态：未绑定智能体 / 智能体已删除 / 已停用，视觉区分
//   - 列表视图行为完全保留，本组件只负责"流程图"分支
// ─────────────────────────────────────────────────────────────────────────
function WorkflowFlowView(props: {
  wfId: string;
  steps: WorkflowStep[];
  agents: Agent[];
  getAgent: (agentId: string | null) => Agent | null;
  openInsertStep: (workflowId: string, insertAfterOrder: number) => void;
  openEditStep: (workflowId: string, step: WorkflowStep) => void;
  deleteStep: (step: WorkflowStep) => void;
  toggleStepEnabled: (step: WorkflowStep) => Promise<void> | void;
  bindAgentToStep: (step: WorkflowStep, agentId: string) => Promise<void>;
  // 4.27up 阶段三（第一轮）：上移/下移
  moveStep: (step: WorkflowStep, direction: "up" | "down") => Promise<void>;
  moving: { stepId: string; direction: "up" | "down" } | null;
  openAddStep: (workflowId: string, defaultOrder: number) => void;
}) {
  const { wfId, steps, agents, getAgent, openInsertStep, openEditStep, deleteStep, toggleStepEnabled, bindAgentToStep, moveStep, moving, openAddStep } = props;
  // 阶段二：当前激活绑定浮层的步骤 id（null = 关闭）。同一时间只允许一个浮层打开。
  const [bindingStepId, setBindingStepId] = useState<string | null>(null);
  // 4.29up：跳转到智能体管理（流程图节点里的"已绑定智能体"chip 可点击）
  const flowRouter = useRouter();

  if (steps.length === 0) {
    return (
      <div className="rounded-[12px] bg-gray-50/60 border border-dashed border-gray-200 px-4 py-8 text-center">
        <p className="text-sm text-gray-400 mb-3">暂无步骤</p>
        <button
          onClick={() => openAddStep(wfId, 0)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-[#002FA7] border border-[#002FA7]/30 rounded-[8px] hover:bg-[#002FA7]/5 transition-colors"
        >
          <Plus size={12} /> 添加第一个步骤
        </button>
      </div>
    );
  }

  // 执行类型 → 视觉
  const typeStyle: Record<WorkflowStep["exec_type"], { bg: string; border: string; text: string; label: string }> = {
    agent:    { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-600",   label: "智能体" },
    manual:   { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-600",  label: "人工执行" },
    review:   { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-600", label: "人工审核" },
    external: { bg: "bg-gray-50",   border: "border-gray-200",   text: "text-gray-600",   label: "外部工具" },
  };
  const TypeIcon = (t: WorkflowStep["exec_type"]) => {
    if (t === "agent")    return <Bot size={11} />;
    if (t === "manual")   return <User size={11} />;
    if (t === "review")   return <Eye size={11} />;
    return <Wrench size={11} />;
  };

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1 pb-2">
        <div className="flex items-stretch gap-0 min-w-min">
          {/* 第一个节点前的插入按钮 */}
          <InsertSlot onClick={() => openInsertStep(wfId, 0)} disabled={moving !== null} />

          {steps.map((step, idx) => {
            const style = typeStyle[step.exec_type];
            const isAgent = step.exec_type === "agent";
            const agent = isAgent ? getAgent(step.agent_id) : null;
            const agentMissingId = isAgent && step.agent_id && !agent;
            const noAgentBound  = isAgent && !step.agent_id;
            const isExternalAgent = isAgent && agent?.agent_type === "external";

            return (
              <div key={step.id} className="flex items-stretch">
                {/* 节点卡片 */}
                <div
                  className={`flex flex-col w-[240px] flex-shrink-0 rounded-[12px] border bg-white ${style.border} ${
                    step.enabled ? "" : "opacity-60"
                  }`}
                  style={{ minHeight: "150px" }}
                >
                  {/* 头部：序号 + 类型徽章 */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#002FA7]/10 text-[#002FA7] text-[11px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 ${style.bg} ${style.text}`}>
                        {TypeIcon(step.exec_type)}
                        {style.label}
                      </span>
                    </div>
                    {!step.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">已停用</span>
                    )}
                  </div>

                  {/* 主体 */}
                  <div className="flex-1 px-3 py-2 min-h-0">
                    <p className="text-sm font-medium text-gray-800 truncate" title={step.title}>
                      {step.title}
                    </p>
                    {/* 智能体绑定状态 */}
                    {isAgent && (
                      <div className="mt-2 relative">
                        {noAgentBound && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">
                              未绑定智能体
                            </span>
                            <button
                              onClick={() => setBindingStepId((cur) => (cur === step.id ? null : step.id))}
                              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[#002FA7]/10 text-[#002FA7] hover:bg-[#002FA7]/20 transition-colors"
                              title="绑定智能体"
                              aria-label="绑定智能体"
                            >
                              <Plus size={10} /> 绑定智能体
                            </button>
                          </div>
                        )}
                        {agentMissingId && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 border border-red-200">
                              智能体已删除
                            </span>
                            <button
                              onClick={() => setBindingStepId((cur) => (cur === step.id ? null : step.id))}
                              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-[#002FA7]/10 text-[#002FA7] hover:bg-[#002FA7]/20 transition-colors"
                              title="重新绑定智能体"
                              aria-label="重新绑定智能体"
                            >
                              <Plus size={10} /> 重新绑定
                            </button>
                          </div>
                        )}
                        {agent && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              flowRouter.push(`/admin/agents?focus=${agent.id}&pageSize=100`);
                            }}
                            className="text-xs text-[#002FA7] hover:underline flex items-center gap-1 truncate text-left"
                            title={`跳转到智能体：${agent.name}`}
                          >
                            {isExternalAgent ? <ExternalLink size={10} /> : <Bot size={10} />}
                            <span className="truncate">{agent.name}</span>
                            <span className={`ml-1 text-[10px] px-1 py-px rounded ${isExternalAgent ? "bg-orange-50 text-orange-500" : "bg-blue-50 text-blue-500"}`}>
                              {isExternalAgent ? "外链" : "chat"}
                            </span>
                          </button>
                        )}

                        {/* 阶段二：绑定智能体浮层 */}
                        {bindingStepId === step.id && (
                          <AgentBindPopover
                            agents={agents}
                            currentAgentId={step.agent_id ?? null}
                            onPick={async (agentId) => {
                              setBindingStepId(null);
                              await bindAgentToStep(step, agentId);
                            }}
                            onClose={() => setBindingStepId(null)}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作区 */}
                  <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-t border-gray-100">
                    {/* 阶段三：上移 / 下移按钮（操作期间所有相邻按钮禁用，避免快速连点导致顺序错乱） */}
                    {/* loading 显示在被点击的方向按钮上：避免下移时上移按钮转圈的反直觉 */}
                    <button
                      onClick={() => moveStep(step, "up")}
                      disabled={idx === 0 || moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="上移"
                      aria-label="上移"
                    >
                      {moving?.stepId === step.id && moving.direction === "up" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
                    </button>
                    <button
                      onClick={() => moveStep(step, "down")}
                      disabled={idx === steps.length - 1 || moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="下移"
                      aria-label="下移"
                    >
                      {moving?.stepId === step.id && moving.direction === "down" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
                    </button>
                    <button
                      onClick={() => toggleStepEnabled(step)}
                      disabled={moving !== null}
                      className={`p-1 rounded-[6px] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed ${step.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`}
                      title={step.enabled ? "停用" : "启用"}
                      aria-label={step.enabled ? "停用" : "启用"}
                    >
                      {step.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    </button>
                    <button
                      onClick={() => openEditStep(wfId, step)}
                      disabled={moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="编辑"
                      aria-label="编辑"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={() => deleteStep(step)}
                      disabled={moving !== null}
                      className="p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="删除"
                      aria-label="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* 节点之间的连接线 + 插入按钮 */}
                <ConnectorWithInsert
                  dimmed={!step.enabled || (idx + 1 < steps.length && !steps[idx + 1].enabled)}
                  onInsert={() => openInsertStep(wfId, idx + 1)}
                  disabled={moving !== null}
                />
              </div>
            );
          })}
        </div>
      </div>

      <button
        onClick={() => openAddStep(wfId, steps.length)}
        disabled={moving !== null}
        className="mt-3 w-full py-2 border border-dashed border-gray-200 rounded-[10px] text-sm text-gray-400 hover:text-[#002FA7] hover:border-[#002FA7]/40 transition-colors flex items-center justify-center gap-1 disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:border-gray-200 disabled:cursor-not-allowed"
      >
        <Plus size={14} /> 添加步骤
      </button>
    </div>
  );
}

// 第一个节点之前的插入"+"位
function InsertSlot({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="self-center mx-1 w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-300 hover:text-[#002FA7] hover:border-[#002FA7] flex items-center justify-center transition-colors disabled:opacity-30 disabled:hover:text-gray-300 disabled:hover:border-gray-300 disabled:cursor-not-allowed"
      title="在此插入步骤"
      aria-label="在此插入步骤"
    >
      <Plus size={12} />
    </button>
  );
}

// 节点之间：箭头连接线 + 插入按钮
function ConnectorWithInsert({ dimmed, onInsert, disabled = false }: { dimmed: boolean; onInsert: () => void; disabled?: boolean }) {
  const lineColor = dimmed ? "bg-gray-200" : "bg-gray-300";
  return (
    <div className="self-center flex items-center mx-1">
      <div className={`h-px w-3 ${lineColor}`} />
      <button
        onClick={onInsert}
        disabled={disabled}
        className="w-6 h-6 rounded-full border border-dashed border-gray-300 text-gray-300 hover:text-[#002FA7] hover:border-[#002FA7] flex items-center justify-center transition-colors disabled:opacity-30 disabled:hover:text-gray-300 disabled:hover:border-gray-300 disabled:cursor-not-allowed"
        title="在此插入步骤"
        aria-label="在此插入步骤"
      >
        <Plus size={12} />
      </button>
      <div className={`h-px w-3 ${lineColor}`} />
      <span className={`text-[10px] ${dimmed ? "text-gray-300" : "text-gray-400"}`}>›</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 4.27up 阶段二：智能体快捷绑定浮层（私有组件）
// 严格约束：
//   - 不发起任何额外请求；agents 列表来自父组件已加载的 state（pageSize=100）
//   - 选中后通过 props.onPick 上抛，由父组件统一调用 PATCH（{ execType, agentId }）
//   - 不引入新依赖；纯 div + Tailwind + lucide
//   - 同一时间只允许一个浮层打开（由父组件 bindingStepId 控制）
// ─────────────────────────────────────────────────────────────────────────
function AgentBindPopover(props: {
  agents: Agent[];
  currentAgentId: string | null;
  onPick: (agentId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { agents, currentAgentId, onPick, onClose } = props;
  const [q, setQ] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const keyword = q.trim().toLowerCase();
  const list = keyword
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(keyword) ||
          a.agent_code.toLowerCase().includes(keyword)
      )
    : agents;

  const currentAgent = currentAgentId ? agents.find((a) => a.id === currentAgentId) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[16px] shadow-2xl border border-gray-100 w-full max-w-[440px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">绑定智能体</h3>
            {currentAgent && (
              <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                当前：<span className="font-medium text-gray-700 truncate max-w-[280px]">{currentAgent.name}</span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[8px] text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 搜索 */}
        <div className="px-5 pt-3 pb-2 border-b border-gray-50">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索智能体名称或编号"
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 bg-white"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 px-0.5">
            共 {agents.length} 个可用智能体{keyword && `，匹配 ${list.length} 个`}
          </p>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto py-2 px-2 max-h-[400px]">
          {list.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={22} className="mx-auto text-gray-200 mb-2" />
              <p className="text-[12px] text-gray-400">没有匹配的智能体</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {list.map((a) => {
                const isExternal = a.agent_type === "external";
                const isCurrent = a.id === currentAgentId;
                return (
                  <button
                    key={a.id}
                    onClick={() => !isCurrent && onPick(a.id)}
                    disabled={isCurrent}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-left transition-all ${
                      isCurrent
                        ? "bg-[#002FA7]/8 border border-[#002FA7]/20 cursor-not-allowed"
                        : "border border-transparent hover:bg-gray-50 hover:border-gray-100"
                    }`}
                    title={isCurrent ? "当前已绑定" : `选择：${a.name}`}
                  >
                    <div
                      className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                        isExternal ? "bg-orange-50" : "bg-[#002FA7]/8"
                      }`}
                    >
                      {isExternal ? (
                        <ExternalLink size={15} className="text-orange-500" />
                      ) : (
                        <Bot size={16} className="text-[#002FA7]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[14px] truncate ${isCurrent ? "text-[#002FA7] font-medium" : "text-gray-800"}`}>
                        {a.name}
                      </p>
                      <p className="text-[11px] text-gray-400 font-mono truncate mt-0.5">{a.agent_code}</p>
                    </div>
                    {isCurrent ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#002FA7]/15 text-[#002FA7] font-medium">
                        <Check size={11} /> 已绑定
                      </span>
                    ) : isExternal ? (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-500 border border-orange-100">
                        外链
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">点击列表项即可绑定</p>
          <button
            onClick={onClose}
            className="text-[12px] text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-[8px] hover:bg-gray-100 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
