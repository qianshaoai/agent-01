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
  Plug,
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
  Check,
  Building2,
  Home,
  Lock,
  Layers,
} from "lucide-react";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";

// 6.5up · 补全 published_from_draft_id / platform / description 三个字段，
//   用于三类智能体的区分（自建 / 外部接入 / 外链）和列表内的副信息展示。
//   API 已 select 这些字段（app/api/admin/agents/route.ts:33），仅前端类型补全。
type Agent = {
  id: string;
  agent_code: string;
  name: string;
  agent_type: string;
  external_url: string;
  published_from_draft_id: string | null;
  platform: string;
  description: string;
};
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
  // 5.11up · 创建者信息
  created_by?: string | null;
  created_by_role?: "super_admin" | "system_admin" | "org_admin" | null;
  created_by_username?: string | null;
};

type PermScope = "org" | "dept" | "team";

// R1.8 · 不再手动设 sortOrder（6.3up「分层级配置」+ 全局自动接末尾接管），
//        EMPTY_WF / 回填 / 提交都不写 sortOrder；DB 字段保留作为兜底键。
const EMPTY_WF = {
  name: "",
  description: "",
  category: "",
  enabled: true,
  visibleTo: "all",
  categoryIds: [] as string[],
  permScope: "org" as PermScope,
  permIds: [] as string[],
};
const EMPTY_STEP = { title: "", description: "", execType: "agent" as "agent" | "manual" | "review" | "external", agentId: "", buttonText: "进入智能体", enabled: true, stepOrder: 1 };

// 6.5up · 三类智能体区分（自建 / 外部接入 / 外链）+ 视觉常量单点定义
//   - external_link  : agent_type === "external"，跳转外部 URL
//   - builtin        : agent_type === "chat" && published_from_draft_id != null，agent-builder 发布的
//   - external_api   : agent_type === "chat" && published_from_draft_id == null，直连 coze/dify/zhipu/openai
type AgentSource = "builtin" | "external_api" | "external_link";

function getAgentSource(a: Agent): AgentSource {
  if (a.agent_type === "external") return "external_link";
  if (a.published_from_draft_id) return "builtin";
  return "external_api";
}

const SOURCE_META: Record<AgentSource, {
  label: string;
  Icon: typeof Bot;
  bg: string;
  iconColor: string;
  chipBg: string;
  chipText: string;
  order: number;
}> = {
  builtin:       { label: "自建",     Icon: Bot,          bg: "bg-[#002FA7]/8", iconColor: "text-[#002FA7]",  chipBg: "bg-[#002FA7]/10", chipText: "text-[#002FA7]",  order: 1 },
  external_api:  { label: "外部接入", Icon: Plug,         bg: "bg-violet-50",   iconColor: "text-violet-600", chipBg: "bg-violet-50",    chipText: "text-violet-600", order: 2 },
  external_link: { label: "外链",     Icon: ExternalLink, bg: "bg-orange-50",   iconColor: "text-orange-500", chipBg: "bg-orange-50",    chipText: "text-orange-500", order: 3 },
};

const SOURCE_ORDER: AgentSource[] = ["builtin", "external_api", "external_link"];

export default function WorkflowsAdminPage() {
  const { toast } = useToast();
  // 5.7up · 当前管理员角色，决定 org_admin 是否隐藏 visible_to 选择器
  // 5.9up · 同时拉 tenantCode，用于过滤 dept/team picker、写 scope=org 的 permission
  // 6.4up · 额外拉 source / permissions，处理 custom admin 路径
  const [adminRole, setAdminRole] = useState<"super_admin" | "system_admin" | "org_admin" | null>(null);
  const [adminTenantCode, setAdminTenantCode] = useState<string | null>(null);
  const [accessSource, setAccessSource] = useState<"admin_table" | "user_admin" | "custom_admin" | null>(null);
  const [customPermissions, setCustomPermissions] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAccessSource(d.source ?? null);
        if (d.role) setAdminRole(d.role);
        if (d.tenantCode) setAdminTenantCode(d.tenantCode);
        if (Array.isArray(d.permissions)) setCustomPermissions(new Set(d.permissions));
      })
      .catch(() => {});
  }, []);
  const isOrgAdmin = adminRole === "org_admin";
  // 6.4up · 是否 custom admin（决定大量 UI 分支：复制/删除/启停隐藏；
  //   modal 内 enabled / visible_to / permissions 禁用；create 按钮按权限显示）
  //   注：分类管理 Tab 已于 6.5up 整体迁至 /admin/tags，本页不再有该 Tab
  const isCustomAdmin = accessSource === "custom_admin";
  const hasAnyCustomUpdate =
    customPermissions.has("workflow.update.team") ||
    customPermissions.has("workflow.update.dept") ||
    customPermissions.has("workflow.update.org") ||
    customPermissions.has("workflow.update.all");
  const hasAnyCustomCreate =
    customPermissions.has("workflow.create.team") ||
    customPermissions.has("workflow.create.dept") ||
    customPermissions.has("workflow.create.org") ||
    customPermissions.has("workflow.create.all");
  // R2 收口 · 衍生的 UI 能力（独立 helper 防散落）
  const canCreateWf = isCustomAdmin ? hasAnyCustomCreate : !!adminRole;
  const canCopyWf = !isCustomAdmin; // v1 不开放给 custom admin
  const canDeleteWf = !isCustomAdmin; // v1 不开放
  const canToggleWfEnabled = !isCustomAdmin; // v1 不开放

  // 5.11up · 上下级权限工具：super=3 / system=2 / org=1，actor >= creator 才能动
  const ROLE_LEVEL_MAP: Record<string, number> = { super_admin: 3, system_admin: 2, org_admin: 1 };
  const ROLE_LABEL_MAP: Record<string, string> = { super_admin: "超级管理员", system_admin: "系统管理员", org_admin: "组织管理员" };
  function canTouchWf(wf: Workflow): boolean {
    // 6.4up · custom admin：持有任一 workflow.update.* 即放行编辑（具体 scope 校验由后端做）
    if (isCustomAdmin) return hasAnyCustomUpdate;
    if (!adminRole) return false;
    const creatorRole = wf.created_by_role ?? "system_admin"; // 兜底
    return (ROLE_LEVEL_MAP[adminRole] ?? 0) >= (ROLE_LEVEL_MAP[creatorRole] ?? 0);
  }
  function noTouchReason(wf: Workflow): string {
    if (isCustomAdmin) {
      return hasAnyCustomUpdate
        ? "该工作流超出你的可改范围"
        : "你的角色未授予 workflow 编辑权限";
    }
    const creatorRole = wf.created_by_role ?? "system_admin";
    const label = ROLE_LABEL_MAP[creatorRole] ?? creatorRole;
    return `该工作流由${label}创建，无权修改`;
  }
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  // 6.5up R1 · picker 接口截断标记 + 真实总数，用于 AgentBindPopover 顶部提示
  const [agentsCapped, setAgentsCapped] = useState(false);
  const [agentsTotalCount, setAgentsTotalCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [allDepts, setAllDepts] = useState<Dept[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [tenantSearch, setTenantSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // 6.5up · 分类管理 Tab 已抽到 /admin/tags，本页只保留工作流列表（无 Tab 切换）
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // R1.7 · 分类 section 折叠（与智能体管理风格一致）· 默认全折叠
  const [expandedWfSections, setExpandedWfSections] = useState<Set<string>>(new Set());
  function toggleWfSection(id: string) {
    setExpandedWfSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
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
  // 6.5up · 编辑步骤弹窗里"绑定智能体"用 AgentBindPopover 替代原生 select
  const [showStepFormAgentPicker, setShowStepFormAgentPicker] = useState(false);
  // 5.27up Fix · 防重复提交（详见 lib/hooks/use-submit-guard.ts）
  // 6.5up · addCatGuard 已抽到 /admin/tags
  const saveWfGuard = useSubmitGuard();
  const saveStepGuard = useSubmitGuard();
  const duplicateWfGuard = useSubmitGuard();

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  function showConfirm(message: string, onConfirm: () => void) { setConfirmDialog({ message, onConfirm }); }

  // 6.5up · 分类管理 state（newCatName / editingCatId / editingCatName 等）已抽到 /admin/tags

  // 4.29up：?focus=<wfId>&pageSize=100 跨页定位
  // 关键：客户端 hydrate 后才能读到 window.location.search（lazy state 在 SSR 首次执行时
  //       window 不存在，会被钉成 null）；用 urlReady 防止 load() 抢跑
  const router = useRouter();
  const [focusWfId, setFocusWfId] = useState<string | null>(null);
  const [focusFromAgentId, setFocusFromAgentId] = useState<string | null>(null);
  const [urlPageSize, setUrlPageSize] = useState<number | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const [highlightedWfId, setHighlightedWfId] = useState<string | null>(null);
  // 4.29up：从智能体跳过来时，把使用该 agent 的步骤一并高亮
  const [highlightedStepAgentId, setHighlightedStepAgentId] = useState<string | null>(null);
  const focusFiredRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const f = sp.get("focus");
    const fa = sp.get("fromAgent");
    const ps = sp.get("pageSize");
    setFocusWfId(f);
    setFocusFromAgentId(fa);
    if (ps) {
      const n = parseInt(ps);
      if (Number.isFinite(n) && n > 0) setUrlPageSize(n);
    }
    setUrlReady(true);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const wfPs = urlPageSize && urlPageSize > 0 ? `?pageSize=${urlPageSize}` : "";
      const [wr, ar, cr, tr, dr, teamsR] = await Promise.all([
        fetch(`/api/admin/workflows${wfPs}`).then((r) => r.json()).then(d => d.data ?? d),
        // 6.5up R1 · 走 picker 专用接口（极简字段 + 全量拉 hard cap 2000），
        //   替代 4.27up 阶段一的 ?pageSize=100 兜底；同时拿 capped/totalCount 用于
        //   popover 截断提示。超过 2000 的场景需要做服务端搜索（方案 C），目前留作下一轮。
        fetch("/api/admin/agents/picker").then((r) => r.json()).then(d => ({
          list: Array.isArray(d?.data) ? d.data : [],
          capped: !!d?.capped,
          totalCount: typeof d?.totalCount === "number" ? d.totalCount : 0,
        })),
        fetch("/api/admin/wf-categories").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/tenants").then((r) => r.json()).then(d => d.data ?? d),
        fetch("/api/admin/departments").then((r) => r.json()).then(d => d.data ?? d).catch(() => []),
        fetch("/api/admin/teams").then((r) => r.json()).then(d => d.data ?? d).catch(() => []),
      ]);
      setWorkflows(Array.isArray(wr) ? wr : []);
      setAgents(ar.list);
      setAgentsCapped(ar.capped);
      setAgentsTotalCount(ar.totalCount);
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

  // 等 URL 解析完成（hydrate 后才能读到 window.location.search）才发请求，避免抢跑
  useEffect(() => {
    if (!urlReady) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlReady]);

  // focus 高亮：数据加载完成后清掉筛选 + 展开 + 滚动 + ring 1.5s
  useEffect(() => {
    if (!focusWfId || loading || focusFiredRef.current) return;
    if (workflows.length === 0) return;
    const target = workflows.find((w) => w.id === focusWfId);
    if (!target) {
      // 找不到再下结论才"消耗"focus（数据已经加载完成、但目标不在当前 pageSize 范围内）
      focusFiredRef.current = true;
      toast("目标工作流不在当前页，请翻页查找");
      return;
    }
    focusFiredRef.current = true;
    // 关键：清掉所有筛选条件，确保目标卡片在 filteredWorkflows 中能被渲染
    // （否则即便 setExpandedId 设了，DOM 里也根本没有这张卡可展开）
    setWfSearch("");
    setWfCatFilter("");
    setWfVisibleFilter("");
    setWfStatusFilter("");
    // 自动展开（页面只允许同时展开一条）
    setExpandedId(target.id);
    setHighlightedWfId(target.id);
    // 同步设置 step 高亮（来自智能体页跳转时使用该 agent 的步骤会发亮）
    if (focusFromAgentId) setHighlightedStepAgentId(focusFromAgentId);
    // 双 rAF：等"清筛选 + 展开"两帧 commit 完成后再滚动，避免高度还没变就滚到错位置
    // block:"center" 比 "start" 更稳，避免被 sticky 顶栏遮挡
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-wf-card="${target.id}"]`);
        if (el && el instanceof HTMLElement) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
    setTimeout(() => {
      setHighlightedWfId(null);
      setHighlightedStepAgentId(null);
    }, 1500);
  }, [focusWfId, focusFromAgentId, loading, workflows, toast]);

  // 6.5up · focus 跳转时自动展开 target 所在分类 section（避免目标卡片在折叠的
  //   分类 tbody 里看不到 / 滚到错位置）。仿 app/admin/agents/page.tsx 6.3up 同款
  //   语义：只 add target 所在 section，不收其它 section，让用户保留浏览上下文。
  useEffect(() => {
    if (!focusWfId) return;
    const target = workflows.find((w) => w.id === focusWfId);
    if (!target) return;
    const sectionIds: string[] = (target.categoryIds ?? []).length > 0
      ? target.categoryIds!
      : ["__uncategorized__"];
    setExpandedWfSections((prev) => {
      const next = new Set(prev);
      for (const sid of sectionIds) next.add(sid);
      return next;
    });
  }, [focusWfId, workflows]);

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

    // 5.9up · "org_only + 带 scope=org permission" 是新语义（限定特定组织），
    // 在编辑面板里映射成 custom:org 展示，避免 select 显示成误导性的"仅组织用户可见"。
    // 注：org_admin 的"我所在组织全员可见"也是 org_only + scope=org，但 org_admin 的下拉
    // 没有 custom:org 选项 → 这里只对非 org_admin 做映射，保持 org_admin 原 org_only 视图
    let visibleTo = wf.visible_to;
    let permScope = validScope;
    const hasOrgScopePerm = rules.some((r) => r.scope_type === "org");
    if (!isOrgAdmin && wf.visible_to === "org_only" && hasOrgScopePerm) {
      visibleTo = "custom";
      permScope = "org";
    }

    setWfForm({
      name: wf.name,
      description: wf.description,
      category: wf.category,
      enabled: wf.enabled,
      visibleTo,
      categoryIds: wf.categoryIds ?? [],
      permScope,
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
    await saveWfGuard.submit(async (idempotencyKey) => {
      // 生成 permissions 数组（custom 模式才有；org_admin 选"全员"由后端兜底写 scope=org）
      const permissions = wfForm.visibleTo === "custom"
        ? wfForm.permIds.map((scopeId) => ({ scope_type: wfForm.permScope, scope_id: scopeId }))
        : [];
      // 6.4up · custom admin PATCH 不能带 enabled / visibleTo / permissions（后端会 403）；
      //   POST 时 enabled / visibleTo / permissions 都由后端按 actor scope 兜底
      const body: Record<string, unknown> = {
        name: wfForm.name,
        description: wfForm.description,
        category: wfForm.category,
        // enabled / visibleTo / permissions 仅 builtin 走下方 if(!isCustomAdmin) 追加（custom admin 带则后端 403）
        // sortOrder 不发：R1.8 起全局排序由「分层级配置」管理（本页无排序输入）
        categoryIds: wfForm.categoryIds,
      };
      if (!isCustomAdmin) {
        body.enabled = wfForm.enabled;
        body.visibleTo = wfForm.visibleTo;
        body.permissions = permissions;
      }
      // PATCH 天然幂等；POST 创建带 Idempotency-Key
      const res = editingWf
        ? await fetch(`/api/admin/workflows/${editingWf.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/workflows", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setWfError(data.error ?? "保存失败"); return; }
      setShowWfModal(false); load();
    });
  }

  // 6.5up · 失败不再假成功 —— 把 res.ok 检查 + toast 错误统一加进所有 mutating fetch
  async function toggleWfEnabled(wf: Workflow) {
    // R2 收口 · 检查 res.ok，失败时不要无脑刷新 + 不要静默
    const res = await fetch(`/api/admin/workflows/${wf.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !wf.enabled }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d?.error ?? "切换状态失败", "error");
      return;
    }
    load();
  }

  function duplicateWf(wf: Workflow) {
    showConfirm(`确认复制工作流「${wf.name}」？将连同所有步骤一起复制。`, async () => {
      await duplicateWfGuard.submit(async (idempotencyKey) => {
        // R2 收口 · 检查 res.ok，否则 builtin-only duplicate 对 custom admin 返回 401 时仍 toast "已复制" 误导用户
        const res = await fetch(`/api/admin/workflows/${wf.id}/duplicate`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast(d?.error ?? "复制失败", "error");
          return;
        }
        load(); toast("工作流已复制");
      });
    });
  }

  function deleteWf(wf: Workflow) {
    showConfirm(`确认删除工作流「${wf.name}」？步骤也会一并删除。`, async () => {
      const res = await fetch(`/api/admin/workflows/${wf.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "删除失败", "error");
        return;
      }
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
    // 6.5up · renumber 的 PATCH 失败不再静默：任一失败 toast 报错并提示刷新确认
    const patchOrder = (s: WorkflowStep, idx: number) =>
      s.step_order !== idx + 1
        ? fetch(`/api/admin/workflow-steps/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepOrder: idx + 1 }) })
            .then(r => { if (!r.ok) throw new Error("renumber failed"); })
        : Promise.resolve();

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
        try {
          await Promise.all(reordered.map(patchOrder));
        } catch {
          toast("步骤序号重排可能未完全保存，请刷新确认");
        }
        return;
      }
    }
    // 普通重排：按当前顺序重新编 1,2,3
    try {
      await Promise.all(freshSteps.map(patchOrder));
    } catch {
      toast("步骤序号重排可能未完全保存，请刷新确认");
    }
  }

  async function handleSaveStep() {
    setStepError("");
    if (!stepForm.title.trim()) { setStepError("请填写步骤标题"); return; }
    if (!showStepModal) return;
    await saveStepGuard.submit(async (idempotencyKey) => {
      // 6.4up · custom admin PATCH 不能带 enabled（后端禁止启停步骤），POST 时 enabled 默认 true 即可
      const body: Record<string, unknown> = { stepOrder: stepForm.stepOrder, title: stepForm.title, description: stepForm.description, execType: stepForm.execType, agentId: stepForm.execType === "agent" ? (stepForm.agentId || null) : null, buttonText: stepForm.buttonText };
      if (!isCustomAdmin) body.enabled = stepForm.enabled;
      // PATCH 天然幂等；POST 创建带 Idempotency-Key
      const res = showStepModal.step
        ? await fetch(`/api/admin/workflow-steps/${showStepModal.step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/workflows/${showStepModal.workflowId}/steps`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
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
    });
  }

  function deleteStep(step: WorkflowStep) {
    showConfirm(`确认删除步骤「${step.title}」？`, async () => {
      const wf = workflows.find(w => w.workflow_steps?.some(s => s.id === step.id));
      // R2 收口 · 检查 res.ok（custom admin 对 step DELETE 是 fail-closed）
      const res = await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "删除步骤失败", "error");
        return;
      }
      await load();
      if (wf) await renumberSteps(wf.id);
      await load();
      toast("步骤已删除");
    });
  }

  async function toggleStepEnabled(step: WorkflowStep) {
    // R2 收口 · 检查 res.ok（custom admin 对 step enabled 是 fail-closed）
    const res = await fetch(`/api/admin/workflow-steps/${step.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !step.enabled }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d?.error ?? "切换步骤状态失败", "error");
      return;
    }
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

  // 5.16up · R5 步骤列表视图拖拽改顺序：拖 GripVertical 抓手、落到目标步骤即重排。
  // 后端 PUT 走原子重排 RPC，失败强制 load() 重拉真实顺序、不保留错误乐观序。
  const [dragStepId, setDragStepId] = useState<string | null>(null);
  const [dragOverStepId, setDragOverStepId] = useState<string | null>(null);

  async function reorderStepsByDrag(wf: Workflow, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const sorted = [...(wf.workflow_steps ?? [])].sort((a, b) => a.step_order - b.step_order);
    const fromIdx = sorted.findIndex((s) => s.id === draggedId);
    const toIdx = sorted.findIndex((s) => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const orderedIds = reordered.map((s) => s.id);
    // 乐观更新：按新序重设 step_order
    setWorkflows((prev) => prev.map((w) =>
      w.id === wf.id
        ? { ...w, workflow_steps: reordered.map((s, i) => ({ ...s, step_order: i + 1 })) }
        : w
    ));
    let ok = false;
    try {
      const res = await fetch(`/api/admin/workflows/${wf.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepIds: orderedIds }),
      });
      ok = res.ok;
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d.error ?? "排序未保存，请重试");
      }
    } catch {
      toast("排序未保存，请重试");
    }
    // 失败 → 强制重拉真实顺序，不保留错误乐观序（成功时乐观序与 RPC 结果一致，无需重拉）
    if (!ok) await load();
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

  // 6.5up · addWfCategory / saveEditWfCat / deleteWfCat / handleWfCatIcon / removeWfCatIcon
  //        已抽到 /admin/tags 页面（不动后端 API，仅前端搬迁）

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<GitBranch size={20} />}
          title="工作流管理"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {workflows.length} 个</span>}
          actions={
            <>
              {/* 6.3up R1.1 · 工作流配置入口（仅 super/system_admin 可见，与服务端 isWorkflowConfigAdmin 一致） */}
              {(adminRole === "super_admin" || adminRole === "system_admin") && (
                <Button
                  variant="outline"
                  onClick={() => router.push("/admin/workflow-config")}
                  className="gap-2"
                  title="按组织 / 部门 / 小组配置工作流的展示与排序"
                >
                  <Layers size={16} /> 工作流配置
                </Button>
              )}
              {/* 6.4up · custom admin 仅在持 create 权限时显示「新增工作流」（分类管理 Tab 已于 6.5up 迁至 /admin/tags） */}
              {canCreateWf && (
                <Button onClick={openAddWf} className="gap-2"><Plus size={16} /> 新增工作流</Button>
              )}
            </>
          }
        />

        {/* 6.5up · 工作流列表主体（旧分类管理 Tab 已抽到 /admin/tags） */}
        <>

        {/* 筛选栏 */}
        <Card padding="md" className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full h-10 border border-gray-200 rounded-[10px] pl-9 pr-3 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" placeholder="搜索工作流名称…" value={wfSearch} onChange={e => setWfSearch(e.target.value)} />
          </div>
          <select className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={wfCatFilter} onChange={e => setWfCatFilter(e.target.value)}>
            <option value="">全部标签</option>
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
          // 5.16up R6 方案乙 · 按工作流分类分区分组（多分类工作流在每个所属分类各出现一次，
          // 与 R4 后台分组口径一致；空分类归"未分类"兜底区；不改 DB、区内仍用全局 sort_order）
          const groupedWfSections = (() => {
            const cats = wfCatFilter ? categories.filter((c) => c.id === wfCatFilter) : categories;
            const sections = cats.map((c) => ({
              id: c.id,
              name: c.name,
              icon_url: c.icon_url ?? null,
              workflows: filteredWorkflows.filter((wf) => (wf.categoryIds ?? []).includes(c.id)),
            }));
            if (!wfCatFilter) {
              const uncat = filteredWorkflows.filter((wf) => (wf.categoryIds ?? []).length === 0);
              if (uncat.length > 0) {
                sections.push({ id: "__uncategorized__", name: "未设置标签", icon_url: null, workflows: uncat });
              }
            }
            return sections.filter((s) => s.workflows.length > 0);
          })();
          return filteredWorkflows.length === 0 ? (
          <Card padding="lg" className="py-16 text-center text-gray-400">
            <GitBranch size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm">{workflows.length === 0 ? "暂无工作流，点击右上角新增" : "没有符合筛选条件的工作流"}</p>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* 5.16up R6 方案乙 · 按工作流分类分区展示（不改 DB，非真隔离） */}
            <p className="text-[12px] text-gray-400 px-1">
              按标签分区展示；区内仍按全局顺序排列 —— 分区视图，非各标签独立排序。
            </p>
            {groupedWfSections.map((section) => {
            const sectionExpanded = expandedWfSections.has(section.id);
            return (
            <div key={section.id}>
              {/* R1.7 · 分类 header · 卡片化（与下面工作流卡片视觉一致）+ chevron 折叠 */}
              <button
                type="button"
                onClick={() => toggleWfSection(section.id)}
                className="card card-hover w-full flex items-center gap-3 px-5 py-4 mb-3 text-left"
              >
                {sectionExpanded
                  ? <ChevronDown size={18} className="text-gray-500 shrink-0" />
                  : <ChevronRight size={18} className="text-gray-500 shrink-0" />}
                {section.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={section.icon_url} alt={section.name} className="w-7 h-7 rounded-[8px] object-contain shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-[8px] bg-[#002FA7]/10 flex items-center justify-center shrink-0">
                    <Tag size={15} className="text-[#002FA7]" />
                  </div>
                )}
                <span className="text-[16px] font-semibold text-gray-800">{section.name}</span>
                <span className="text-[12px] text-gray-400 font-medium ml-auto">{section.workflows.length} 个工作流</span>
              </button>
              {sectionExpanded && (
              // R1.14 · 仅靠左缩进表达从属关系（去掉竖线，更简洁）
              <div className="space-y-3 ml-5 mb-3">
            {section.workflows.map((wf) => {
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
                        {/* 6.3up · 分类标签 chip + 简介 + 可见范围 chip 下沉到展开区，折叠态保留停用 + 创建者 */}
                        {!wf.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">已停用</span>}
                        {/* 6.3up · 创建者徽章已下沉到展开区 chip 行 */}
                      </div>
                      {/* 6.3up · 简介下沉到展开区（不再 truncate）*/}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-gray-400 mr-2">{steps.length} 个步骤</span>
                      {/* 5.11up · 决策 5=A：无权时按钮置灰 + tooltip 说明原因，不直接隐藏 */}
                      {/* 6.4up · custom admin 直接隐藏 启停 / 复制 / 删除 三类按钮（v1 不开放） */}
                      {(() => {
                        const ok = canTouchWf(wf);
                        const reason = ok ? "" : noTouchReason(wf);
                        return <>
                          {canToggleWfEnabled && (
                            <button onClick={() => ok && toggleWfEnabled(wf)} disabled={!ok} className={`p-1.5 rounded-[8px] transition-colors ${!ok ? "text-gray-300 cursor-not-allowed" : wf.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`} title={ok ? (wf.enabled ? "停用" : "启用") : reason}>
                              {wf.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                            </button>
                          )}
                          {canCopyWf && (
                            <button onClick={() => duplicateWf(wf)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="复制工作流" aria-label="复制工作流"><Copy size={14} /></button>
                          )}
                          <button onClick={() => ok && openEditWf(wf)} disabled={!ok} className={`p-1.5 rounded-[8px] transition-colors ${!ok ? "text-gray-300 cursor-not-allowed" : "hover:bg-gray-100 text-gray-400 hover:text-gray-600"}`} title={ok ? "编辑" : reason} aria-label="编辑"><Edit2 size={14} /></button>
                          {canDeleteWf && (
                            <button onClick={() => ok && deleteWf(wf)} disabled={!ok} className={`p-1.5 rounded-[8px] transition-colors ${!ok ? "text-gray-300 cursor-not-allowed" : "hover:bg-red-50 text-gray-400 hover:text-red-500"}`} title={ok ? "删除" : reason} aria-label="删除"><Trash2 size={14} /></button>
                          )}
                        </>;
                      })()}
                    </div>
                  </div>

                  {/* Steps */}
                  {isExpanded && (
                    <div className="border-t border-gray-50 px-5 pb-4 pt-3">
                      {/* 4.27up 阶段一：视图切换 Tab · 6.3up · 右侧紧邻分类标签 chip（折叠态从头部下沉）*/}
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-[8px] w-fit shrink-0">
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
                        {/* 6.3up · 分类标签 + 可见范围 聚合 chip 行（紧贴 Tab 右侧；都是图标按钮 + 点击 popup）*/}
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 分类标签 chip · 聚合为单按钮 · 点击 popup 显示所有标签名 + 图标 */}
                          <ChipPopover
                            label="标签"
                            theme="green"
                            triggerIcon={<Tag size={12} />}
                            items={(wf.categoryIds ?? [])
                              .map((cid) => {
                                const cat = categories.find((c) => c.id === cid);
                                if (!cat) return null;
                                return { name: cat.name, iconUrl: cat.icon_url };
                              })
                              .filter(Boolean) as ChipItem[]}
                          />
                          {/* 6.3up · 可见范围 chip · 「指定 XXX」改为 Home 按钮 + 点击 popup */}
                          {wf.visible_to === "org_only" && (() => {
                            // 5.9up · 区分两种 'org_only' 语义：
                            //   - 无 scope=org permission → "仅组织用户" 文字 chip（无 popup）
                            //   - 有 scope=org permission → Home 按钮 + popup
                            const orgRules = (wf.permissions ?? []).filter((r) => r.scope_type === "org");
                            if (orgRules.length === 0) {
                              return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">仅组织用户</span>;
                            }
                            const items: ChipItem[] = orgRules
                              .map((r) => tenants.find((t) => t.code === r.scope_id)?.name ?? r.scope_id ?? "")
                              .filter((n): n is string => !!n)
                              .map((name) => ({ name }));
                            return <ChipPopover label="指定组织" theme="amber" triggerIcon={<Home size={12} />} items={items} />;
                          })()}
                          {wf.visible_to === "personal_only" && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">仅个人用户</span>
                          )}
                          {wf.visible_to === "custom" && (() => {
                            const rules = wf.permissions ?? [];
                            const firstType = rules[0]?.scope_type;
                            const typeLabel = firstType === "dept" ? "指定部门"
                                           : firstType === "team" ? "指定小组"
                                           : "指定组织";
                            // 5.9up · 把 scope_id 解析成可读名称；dept/team 带上母公司前缀，便于跨组织辨认
                            const items: ChipItem[] = rules.map((r): ChipItem => {
                              if (r.scope_type === "org") {
                                return { name: tenants.find((t) => t.code === r.scope_id)?.name ?? r.scope_id ?? "" };
                              }
                              if (r.scope_type === "dept") {
                                const d = allDepts.find((x) => x.id === r.scope_id);
                                if (!d) return { name: r.scope_id ?? "" };
                                const tenant = tenants.find((t) => t.code === d.tenant_code)?.name;
                                return { name: tenant ? `${tenant} / ${d.name}` : d.name };
                              }
                              if (r.scope_type === "team") {
                                const tm = allTeams.find((x) => x.id === r.scope_id);
                                if (!tm) return { name: r.scope_id ?? "" };
                                const d = allDepts.find((x) => x.id === tm.dept_id);
                                const tenant = d ? tenants.find((t) => t.code === d.tenant_code)?.name : null;
                                if (tenant && d) return { name: `${tenant} / ${d.name} / ${tm.name}` };
                                if (d) return { name: `${d.name} / ${tm.name}` };
                                return { name: tm.name };
                              }
                              return { name: r.scope_id ?? "" };
                            }).filter((it) => !!it.name);
                            return <ChipPopover label={typeLabel} theme="amber" triggerIcon={<Home size={12} />} items={items} />;
                          })()}
                          {/* 兼容旧数据：visible_to 不是任何预设也不是 custom，走旧的逗号分隔组织码格式 */}
                          {wf.visible_to && wf.visible_to !== "all" && wf.visible_to !== "org_only" && wf.visible_to !== "personal_only" && wf.visible_to !== "custom" && (
                            <ChipPopover label="指定组织可见" theme="amber" triggerIcon={<Home size={12} />} items={[{ name: wf.visible_to }]} />
                          )}
                          {/* 5.12up 创建者徽章 · 6.3up 下沉到此处 · Lock 按钮 + popup 显示可修改本工作流的管理员 */}
                          {wf.created_by_role && (() => {
                            const creatorLevel = ROLE_LEVEL_MAP[wf.created_by_role] ?? 0;
                            const allowedRoles = (["super_admin", "system_admin", "org_admin"] as const)
                              .filter((role) => (ROLE_LEVEL_MAP[role] ?? 0) >= creatorLevel);
                            const items: ChipItem[] = allowedRoles.map((role) => ({
                              name: ROLE_LABEL_MAP[role] ?? role,
                            }));
                            return <ChipPopover label="可修改本工作流的管理员" theme="gray" triggerIcon={<Lock size={12} />} items={items} />;
                          })()}
                        </div>
                      </div>

                      {/* 6.3up · 完整简介行（不 truncate · 多行 wrap · 折叠态从头部下沉）*/}
                      {wf.description && (
                        <p className="text-sm text-gray-500 mb-3 leading-relaxed whitespace-pre-wrap">{wf.description}</p>
                      )}

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
                          highlightedStepAgentId={highlightedStepAgentId}
                          agentsCapped={agentsCapped}
                          agentsTotalCount={agentsTotalCount}
                          canEditSteps={canTouchWf(wf)}
                          isCustomAdmin={isCustomAdmin}
                        />
                      ) : (
                      <>
                      <div className="space-y-2">
                        {steps.length === 0 ? (
                          <p className="text-sm text-gray-400 py-3 text-center">暂无步骤</p>
                        ) : (
                          steps.map((step, idx) => (
                            <div key={step.id}>
                              {/* 在每个步骤前插入按钮（第一个步骤前）·· 5.11up 同步守卫 */}
                              {idx === 0 && (
                                <button onClick={() => canTouchWf(wf) && openInsertStep(wf.id, 0)} disabled={!canTouchWf(wf)} className={`w-full flex items-center gap-1 py-0.5 text-xs transition-colors group mb-1 ${!canTouchWf(wf) ? "text-gray-200 cursor-not-allowed" : "text-gray-300 hover:text-[#002FA7]"}`} title={canTouchWf(wf) ? "插入步骤" : noTouchReason(wf)}>
                                  <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                                  <PlusCircle size={12} />
                                  <span>插入</span>
                                  <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                                </button>
                              )}
                            <div
                              onDragOver={(e) => { if (dragStepId && dragStepId !== step.id) { e.preventDefault(); setDragOverStepId(step.id); } }}
                              onDragLeave={() => setDragOverStepId((cur) => (cur === step.id ? null : cur))}
                              onDrop={(e) => {
                                e.preventDefault();
                                const dragged = dragStepId;
                                setDragStepId(null); setDragOverStepId(null);
                                if (dragged) reorderStepsByDrag(wf, dragged, step.id);
                              }}
                              className={`flex items-start gap-3 p-3 rounded-[12px] transition-all ${step.enabled ? "bg-gray-50" : "bg-gray-50/50 opacity-60"} ${highlightedStepAgentId && step.agent_id === highlightedStepAgentId ? "ring-2 ring-[#002FA7] bg-[#002FA7]/5" : ""} ${dragStepId === step.id ? "opacity-40" : ""} ${dragOverStepId === step.id && dragStepId !== step.id ? "ring-2 ring-dashed ring-[#002FA7]/50" : ""}`}
                            >
                              <span
                                draggable={canTouchWf(wf)}
                                onDragStart={(e) => { setDragStepId(step.id); e.dataTransfer.effectAllowed = "move"; }}
                                onDragEnd={() => { setDragStepId(null); setDragOverStepId(null); }}
                                className={`mt-0.5 shrink-0 ${canTouchWf(wf) ? "cursor-grab active:cursor-grabbing text-gray-400 hover:text-[#002FA7]" : "cursor-not-allowed text-gray-200"}`}
                                title={canTouchWf(wf) ? "拖动调整步骤顺序" : noTouchReason(wf)}
                              >
                                <GripVertical size={14} />
                              </span>
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
                                      {(() => {
                                        const meta = SOURCE_META[getAgentSource(boundAgent)];
                                        return <meta.Icon size={10} className={meta.iconColor} />;
                                      })()}
                                      <span className="truncate max-w-[260px]">绑定：{boundAgent.name}</span>
                                    </button>
                                  );
                                })()}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {/* 5.11up · 步骤层面的写操作守卫，跟所属 workflow 共用判断 */}
                                {(() => {
                                  const okStep = canTouchWf(wf);
                                  const reasonStep = okStep ? "" : noTouchReason(wf);
                                  return <>
                                    {/* 5.16up R5 · 上 / 下移：拖拽的窄屏 / 无障碍 fallback */}
                                    <button onClick={() => okStep && moveStep(step, "up")} disabled={!okStep || moving !== null || idx === 0} className={`p-1 rounded-[6px] transition-colors ${(!okStep || idx === 0) ? "text-gray-200 cursor-not-allowed" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"}`} title={okStep ? "上移" : reasonStep} aria-label="上移"><ArrowUp size={12} /></button>
                                    <button onClick={() => okStep && moveStep(step, "down")} disabled={!okStep || moving !== null || idx === steps.length - 1} className={`p-1 rounded-[6px] transition-colors ${(!okStep || idx === steps.length - 1) ? "text-gray-200 cursor-not-allowed" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"}`} title={okStep ? "下移" : reasonStep} aria-label="下移"><ArrowDown size={12} /></button>
                                    {/* 6.4up · custom admin 隐藏步骤启停 / 删除 */}
                                    {!isCustomAdmin && (
                                      <button onClick={() => okStep && toggleStepEnabled(step)} disabled={!okStep} className={`p-1 rounded-[6px] transition-colors text-xs ${!okStep ? "text-gray-300 cursor-not-allowed" : step.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`} title={okStep ? (step.enabled ? "停用" : "启用") : reasonStep}>
                                        {step.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                      </button>
                                    )}
                                    <button onClick={() => okStep && openEditStep(wf.id, step)} disabled={!okStep} className={`p-1 rounded-[6px] transition-colors ${!okStep ? "text-gray-300 cursor-not-allowed" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"}`} title={okStep ? "编辑步骤" : reasonStep}><Edit2 size={12} /></button>
                                    {!isCustomAdmin && (
                                      <button onClick={() => okStep && deleteStep(step)} disabled={!okStep} className={`p-1 rounded-[6px] transition-colors ${!okStep ? "text-gray-300 cursor-not-allowed" : "hover:bg-red-50 text-gray-400 hover:text-red-400"}`} title={okStep ? "删除步骤" : reasonStep}><Trash2 size={12} /></button>
                                    )}
                                  </>;
                                })()}
                              </div>
                            </div>
                            {/* 每个步骤后面的插入按钮（5.11up · 同步守卫） */}
                            <button onClick={() => canTouchWf(wf) && openInsertStep(wf.id, idx + 1)} disabled={!canTouchWf(wf)} className={`w-full flex items-center gap-1 py-0.5 text-xs transition-colors group mt-1 ${!canTouchWf(wf) ? "text-gray-200 cursor-not-allowed" : "text-gray-300 hover:text-[#002FA7]"}`} title={canTouchWf(wf) ? "插入步骤" : noTouchReason(wf)}>
                              <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                              <PlusCircle size={12} />
                              <span>插入</span>
                              <div className="flex-1 h-px bg-gray-100 group-hover:bg-[#002FA7]/20" />
                            </button>
                            </div>
                          ))
                        )}
                      </div>
                      <button onClick={() => canTouchWf(wf) && openAddStep(wf.id, steps.length)} disabled={!canTouchWf(wf)} className={`mt-3 w-full py-2 border border-dashed rounded-[10px] text-sm transition-colors flex items-center justify-center gap-1 ${!canTouchWf(wf) ? "border-gray-100 text-gray-300 cursor-not-allowed" : "border-gray-200 text-gray-400 hover:text-[#002FA7] hover:border-[#002FA7]/40"}`} title={canTouchWf(wf) ? "添加步骤" : noTouchReason(wf)}>
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
              )}
            </div>
            );
            })}
          </div>
        );
        })()}

        </>

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
                <label className="text-sm font-medium text-gray-700">所属标签（可多选）</label>
                {categories.length === 0 ? (
                  <p className="text-xs text-gray-400">暂无标签，请先在「标签管理」中创建</p>
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
                    <p className="text-xs text-gray-400">不选则此工作流不出现在任何标签筛选下</p>
                  </>
                )}
              </div>
              {/* R1.8 · 删除"排序"输入框 —— 全局排序由「分层级配置」管理；新建自动接末尾；DB 字段保留作为兜底键 */}
              {/* 6.4up · custom admin 不显示「可见权限」区块：可见范围由后端按 actor scope 自动决定，前端没有调整入口 */}
              {!isCustomAdmin && <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">可见权限</label>
                {/* 5.9up · org_admin 限定本组织范围三档可选 */}
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
                  {isOrgAdmin ? (
                    <>
                      <option value="org_only">我所在组织全员可见</option>
                      <option value="custom:dept">指定本组织部门可见</option>
                      <option value="custom:team">指定本组织小组可见</option>
                    </>
                  ) : (
                    <>
                      <option value="all">全部用户可见</option>
                      <option value="org_only">仅组织用户可见</option>
                      <option value="personal_only">仅个人用户可见</option>
                      <option value="custom:org">指定组织可见</option>
                      <option value="custom:dept">指定部门可见</option>
                      <option value="custom:team">指定小组可见</option>
                    </>
                  )}
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
                      placeholder={isOrgAdmin ? "搜索部门名称…" : "搜索组织或部门名称…"}
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-60 overflow-y-auto">
                      {(() => {
                        const q = tenantSearch.toLowerCase();
                        // 5.9up · org_admin 只看自己的组织；super/system 看全部
                        const visibleTenants = isOrgAdmin
                          ? tenants.filter((t) => t.code === adminTenantCode)
                          : tenants;
                        // 按组织分组
                        const groups = visibleTenants
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
                      placeholder={isOrgAdmin ? "搜索部门/小组名称…" : "搜索组织/部门/小组名称…"}
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                    />
                    <div className="border border-gray-200 rounded-[12px] p-3 max-h-72 overflow-y-auto">
                      {(() => {
                        const q = tenantSearch.toLowerCase();
                        // 5.9up · org_admin 只看自己的组织
                        const visibleTenants = isOrgAdmin
                          ? tenants.filter((t) => t.code === adminTenantCode)
                          : tenants;
                        const groups = visibleTenants
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
              </div>}
              {/* 6.4up · custom admin 隐藏 enabled 复选框（后端禁止改 enabled） */}
              {!isCustomAdmin && <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={wfForm.enabled} onChange={(e) => setWfForm({ ...wfForm, enabled: e.target.checked })} />
                <span className="text-sm text-gray-700">启用</span>
              </label>}
              {wfError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{wfError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowWfModal(false)}>取消</Button>
              <Button onClick={handleSaveWf} loading={saveWfGuard.loading}>{editingWf ? "保存" : "创建"}</Button>
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
                    {/* 6.5up · 原生 select 替换为可搜索 / 三类分组的触发器按钮 + AgentBindPopover */}
                    <button
                      type="button"
                      onClick={() => setShowStepFormAgentPicker(true)}
                      className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm bg-white text-left flex items-center gap-2 hover:border-[#002FA7]/40 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
                    >
                      {(() => {
                        const cur = stepForm.agentId ? agents.find((a) => a.id === stepForm.agentId) : null;
                        if (!cur) {
                          return <span className="flex-1 text-gray-400">点击选择智能体</span>;
                        }
                        const src = getAgentSource(cur);
                        const meta = SOURCE_META[src];
                        return (
                          <>
                            <meta.Icon size={15} className={meta.iconColor} />
                            <span className="flex-1 truncate text-gray-900">{cur.name}</span>
                            {src === "external_api" && cur.platform ? (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-violet-100 ${meta.chipBg} ${meta.chipText}`}>
                                {cur.platform}
                              </span>
                            ) : src === "external_link" ? (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-orange-100 ${meta.chipBg} ${meta.chipText}`}>
                                外链
                              </span>
                            ) : null}
                          </>
                        );
                      })()}
                      <ChevronDown size={14} className="text-gray-400 shrink-0" />
                    </button>
                  </div>
                  <Input label="按钮文案" placeholder="如 进入智能体、打开工具" value={stepForm.buttonText} onChange={(e) => setStepForm({ ...stepForm, buttonText: e.target.value })} />
                </>
              )}
              {/* 6.4up · custom admin 隐藏 step enabled 复选框（后端禁止启停步骤） */}
              {!isCustomAdmin && <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-[#002FA7] w-4 h-4" checked={stepForm.enabled} onChange={(e) => setStepForm({ ...stepForm, enabled: e.target.checked })} />
                <span className="text-sm text-gray-700">启用此步骤</span>
              </label>}
              {stepError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{stepError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowStepModal(null)}>取消</Button>
              <Button onClick={handleSaveStep} loading={saveStepGuard.loading}>{showStepModal.step ? "保存" : "添加"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 6.5up · 编辑步骤弹窗里的"绑定智能体"picker（叠在编辑弹窗之上，z-[60]） */}
      {showStepFormAgentPicker && (
        <AgentBindPopover
          agents={agents}
          currentAgentId={stepForm.agentId || null}
          allowClear
          capped={agentsCapped}
          totalCount={agentsTotalCount}
          onPick={(id) => {
            setStepForm({ ...stepForm, agentId: id });
            setShowStepFormAgentPicker(false);
          }}
          onClose={() => setShowStepFormAgentPicker(false)}
        />
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
  // 4.29up：从智能体跳过来时高亮使用该 agent 的步骤
  highlightedStepAgentId?: string | null;
  // 6.5up R1 · picker 接口 capped/totalCount 透传给节点内 AgentBindPopover
  agentsCapped: boolean;
  agentsTotalCount: number;
  // 6.4up R2.2 · 与列表视图同口径：custom admin 隐藏启停 / 删除；无 update 权时所有"改"按钮置灰 / 隐藏
  //   canEditSteps：包含 builtin canTouchWf 与 custom hasAnyCustomUpdate 两个语义（外层已合并）
  //   isCustomAdmin：仅用于决定"启停 / 删除"两类按钮是否完全隐藏（v1 不开放给 custom admin）
  canEditSteps: boolean;
  isCustomAdmin: boolean;
}) {
  const { wfId, steps, agents, getAgent, openInsertStep, openEditStep, deleteStep, toggleStepEnabled, bindAgentToStep, moveStep, moving, openAddStep, highlightedStepAgentId, agentsCapped, agentsTotalCount, canEditSteps, isCustomAdmin } = props;

  // 阶段二：当前激活绑定浮层的步骤 id（null = 关闭）。同一时间只允许一个浮层打开。
  const [bindingStepId, setBindingStepId] = useState<string | null>(null);
  // 4.29up：跳转到智能体管理（流程图节点里的"已绑定智能体"chip 可点击）
  const flowRouter = useRouter();

  if (steps.length === 0) {
    return (
      <div className="rounded-[12px] bg-gray-50/60 border border-dashed border-gray-200 px-4 py-8 text-center">
        <p className="text-sm text-gray-400 mb-3">暂无步骤</p>
        {/* R2.2 · 无 update 权时隐藏；列表视图同口径 */}
        {canEditSteps && (
          <button
            onClick={() => openAddStep(wfId, 0)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-[#002FA7] border border-[#002FA7]/30 rounded-[8px] hover:bg-[#002FA7]/5 transition-colors"
          >
            <Plus size={12} /> 添加第一个步骤
          </button>
        )}
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
          {/* 第一个节点前的插入按钮 · R2.2 · 无 update 权时隐藏 */}
          {canEditSteps && (
            <InsertSlot onClick={() => openInsertStep(wfId, 0)} disabled={moving !== null} />
          )}

          {steps.map((step, idx) => {
            const style = typeStyle[step.exec_type];
            const isAgent = step.exec_type === "agent";
            const agent = isAgent ? getAgent(step.agent_id) : null;
            const agentMissingId = isAgent && step.agent_id && !agent;
            const noAgentBound  = isAgent && !step.agent_id;
            // 6.5up · 三类智能体区分（自建 / 外部接入 / 外链）
            const agentSrc = agent ? getAgentSource(agent) : null;
            const agentMeta = agentSrc ? SOURCE_META[agentSrc] : null;

            const isStepHighlighted = !!highlightedStepAgentId && step.agent_id === highlightedStepAgentId;
            return (
              <div key={step.id} className="flex items-stretch">
                {/* 节点卡片 */}
                <div
                  className={`flex flex-col w-[240px] flex-shrink-0 rounded-[12px] border bg-white transition-all ${style.border} ${
                    step.enabled ? "" : "opacity-60"
                  } ${isStepHighlighted ? "ring-2 ring-[#002FA7] ring-offset-2 shadow-[0_0_0_4px_rgba(0,47,167,0.08)]" : ""
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
                            {agentMeta && <agentMeta.Icon size={10} className={agentMeta.iconColor} />}
                            <span className="truncate">{agent.name}</span>
                            {agentMeta && agentSrc && (
                              <span className={`ml-1 text-[10px] px-1 py-px rounded ${agentMeta.chipBg} ${agentMeta.chipText}`}>
                                {agentSrc === "external_api" ? (agent.platform || "外部接入") : agentMeta.label}
                              </span>
                            )}
                          </button>
                        )}

                        {/* 阶段二：绑定智能体浮层 */}
                        {bindingStepId === step.id && (
                          <AgentBindPopover
                            agents={agents}
                            currentAgentId={step.agent_id ?? null}
                            capped={agentsCapped}
                            totalCount={agentsTotalCount}
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

                  {/* 操作区 · R2.2 · 与列表视图同口径 */}
                  <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-t border-gray-100">
                    {/* 阶段三：上移 / 下移按钮（操作期间所有相邻按钮禁用，避免快速连点导致顺序错乱） */}
                    {/* loading 显示在被点击的方向按钮上：避免下移时上移按钮转圈的反直觉 */}
                    <button
                      onClick={() => moveStep(step, "up")}
                      disabled={!canEditSteps || idx === 0 || moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="上移"
                      aria-label="上移"
                    >
                      {moving?.stepId === step.id && moving.direction === "up" ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
                    </button>
                    <button
                      onClick={() => moveStep(step, "down")}
                      disabled={!canEditSteps || idx === steps.length - 1 || moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="下移"
                      aria-label="下移"
                    >
                      {moving?.stepId === step.id && moving.direction === "down" ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
                    </button>
                    {/* R2.2 · custom admin 隐藏启停按钮（v1 不开放） */}
                    {!isCustomAdmin && (
                      <button
                        onClick={() => toggleStepEnabled(step)}
                        disabled={!canEditSteps || moving !== null}
                        className={`p-1 rounded-[6px] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed ${step.enabled ? "text-[#002FA7] hover:bg-[#002FA7]/10" : "text-gray-300 hover:bg-gray-100"}`}
                        title={step.enabled ? "停用" : "启用"}
                        aria-label={step.enabled ? "停用" : "启用"}
                      >
                        {step.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      </button>
                    )}
                    <button
                      onClick={() => openEditStep(wfId, step)}
                      disabled={!canEditSteps || moving !== null}
                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                      title="编辑"
                      aria-label="编辑"
                    >
                      <Edit2 size={12} />
                    </button>
                    {/* R2.2 · custom admin 隐藏删除按钮（v1 不开放） */}
                    {!isCustomAdmin && (
                      <button
                        onClick={() => deleteStep(step)}
                        disabled={!canEditSteps || moving !== null}
                        className="p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                        title="删除"
                        aria-label="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 节点之间的连接线 + 插入按钮 · R2.2 · 无 update 权时禁用插入 */}
                <ConnectorWithInsert
                  dimmed={!step.enabled || (idx + 1 < steps.length && !steps[idx + 1].enabled)}
                  onInsert={() => openInsertStep(wfId, idx + 1)}
                  disabled={!canEditSteps || moving !== null}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* R2.2 · 底部"添加步骤"：无 update 权时隐藏（含 custom admin 没 update 的情况） */}
      {canEditSteps && (
        <button
          onClick={() => openAddStep(wfId, steps.length)}
          disabled={moving !== null}
          className="mt-3 w-full py-2 border border-dashed border-gray-200 rounded-[10px] text-sm text-gray-400 hover:text-[#002FA7] hover:border-[#002FA7]/40 transition-colors flex items-center justify-center gap-1 disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:border-gray-200 disabled:cursor-not-allowed"
        >
          <Plus size={14} /> 添加步骤
        </button>
      )}
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
  // 6.5up · 编辑步骤弹窗里用 allowClear=true 显示"清空当前绑定"按钮；
  //   节点内快捷绑定场景不传 → 不显示（避免 bindAgentToStep 收到空 agentId 走 catch 报错）
  allowClear?: boolean;
  // 6.5up R1 · picker 接口的截断标记 + 真实总数，capped=true 时顶部显示警告
  capped?: boolean;
  totalCount?: number;
}) {
  const { agents, currentAgentId, onPick, onClose, allowClear, capped, totalCount } = props;
  const [q, setQ] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 6.5up R1 · 搜索覆盖 platform，用户可以搜"coze"/"dify"/"zhipu"直接命中外部接入 agent
  const keyword = q.trim().toLowerCase();
  const list = keyword
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(keyword) ||
          a.agent_code.toLowerCase().includes(keyword) ||
          (a.platform ?? "").toLowerCase().includes(keyword)
      )
    : agents;

  const currentAgent = currentAgentId ? agents.find((a) => a.id === currentAgentId) : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-150"
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
              placeholder="搜索名称 / 编号 / 平台"
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-[10px] focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 bg-white"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 px-0.5">
            共 {agents.length} 个可用智能体{keyword && `，匹配 ${list.length} 个`}
          </p>
          {/* 6.5up R1 · 超过 2000 截断时的红色警告：超出部分需升级服务端搜索后才能查 */}
          {capped && (
            <div className="mt-2 px-2.5 py-2 rounded-[8px] bg-amber-50 border border-amber-200 text-[11px] text-amber-700 leading-relaxed">
              当前数据库共 {totalCount ?? agents.length} 个智能体，超出 2000 已截断。
              <br />超出部分暂时无法在此搜索，请联系开发升级服务端搜索后才能查找。
            </div>
          )}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto py-2 px-2 max-h-[400px]">
          {/* 6.5up · 已绑定时提供"清空"快捷入口（仅 allowClear 时显示，避免节点内快捷绑定路径误传空 agentId） */}
          {allowClear && currentAgentId && (
            <button
              onClick={() => onPick("")}
              className="w-full mb-2 flex items-center gap-3 px-3 py-2 rounded-[10px] text-left border border-dashed border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-[13px] text-gray-500"
            >
              <X size={14} className="text-gray-400" />
              <span>不绑定（清空当前绑定）</span>
            </button>
          )}
          {list.length === 0 ? (
            <div className="py-12 text-center">
              <Search size={22} className="mx-auto text-gray-200 mb-2" />
              <p className="text-[12px] text-gray-400">没有匹配的智能体</p>
            </div>
          ) : (
            // 6.5up · 按三类 source 分组渲染，每组带小标题 + 计数 + 三套图标颜色；
            //   外部接入显示 platform chip（coze/dify/zhipu/openai），外链显示"外链"chip，
            //   自建无 chip（蓝色 Bot 已自证）；空组自动隐藏小标题。
            <div className="flex flex-col gap-3">
              {SOURCE_ORDER.map((src) => {
                const items = list.filter((a) => getAgentSource(a) === src);
                if (items.length === 0) return null;
                const meta = SOURCE_META[src];
                return (
                  <div key={src}>
                    <div className="px-2 py-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                      <meta.Icon size={11} className={meta.iconColor} />
                      <span>{meta.label}</span>
                      <span className="text-gray-400 normal-case">({items.length})</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {items.map((a) => {
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
                            title={isCurrent ? "当前已绑定" : `选择：${a.name}${a.description ? ` — ${a.description}` : ""}`}
                          >
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${meta.bg}`}>
                              <meta.Icon size={16} className={meta.iconColor} />
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
                            ) : src === "external_api" && a.platform ? (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-violet-100 ${meta.chipBg} ${meta.chipText}`}>
                                {a.platform}
                              </span>
                            ) : src === "external_link" ? (
                              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-orange-100 ${meta.chipBg} ${meta.chipText}`}>
                                外链
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
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

// ─── 6.3up · 通用 ChipPopover · 按钮 + 点击 popup 看列表 ────────────
// 用于可见范围（橙色 Home）+ 分类标签（绿色 Tag）等聚合场景。
// 单个时只显示图标；多个时图标 + 数字徽章；点击弹小窗列出全部 items。
// 用 backdrop fixed inset-0 实现 outside click 关闭，无新依赖。
type ChipItem = { name: string; iconUrl?: string | null };
const CHIP_THEME = {
  amber: { bg: "bg-amber-50", text: "text-amber-600", hover: "hover:bg-amber-100" },
  green: { bg: "bg-green-50", text: "text-green-700", hover: "hover:bg-green-100" },
  gray:  { bg: "bg-gray-50",  text: "text-gray-500",  hover: "hover:bg-gray-100"  },
} as const;

function ChipPopover({
  label,
  items,
  triggerIcon,
  theme,
}: {
  label: string;
  items: ChipItem[];
  triggerIcon: React.ReactNode;
  theme: keyof typeof CHIP_THEME;
}) {
  const [open, setOpen] = useState(false);
  const count = items.length;
  if (count === 0) return null;
  const colors = CHIP_THEME[theme];
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${colors.bg} ${colors.text} ${colors.hover}`}
        title={`${label}（共 ${count} 项）`}
        aria-label={`${label} 详情`}
      >
        {triggerIcon}
        {/* 6.5up · count=1 时也显示数字，避免单标签时 icon 后面空着、和无内容 chip 视觉混淆 */}
        <span>{count}</span>
      </button>
      {open && (
        <>
          {/* backdrop · 点击外部关闭 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute z-50 top-full left-0 mt-1 min-w-[240px] max-w-[360px] bg-white rounded-[10px] shadow-lg border border-gray-100 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={colors.text}>{triggerIcon}</span>
              <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{label}</span>
              <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap">{count} 项</span>
            </div>
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-gray-600 px-1 py-0.5 hover:bg-gray-50 rounded">
                  {item.iconUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.iconUrl} alt="" className="w-3.5 h-3.5 rounded-[3px] object-contain shrink-0" />
                  )}
                  <span className="break-all">{item.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
