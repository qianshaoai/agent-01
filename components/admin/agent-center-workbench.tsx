"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bot,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  EyeOff,
  ExternalLink,
  GitBranch,
  Key,
  LayoutGrid,
  Library,
  Loader2,
  MoreHorizontal,
  Plus,
  PlusCircle,
  Plug,
  RotateCcw,
  Search,
  Settings2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";

type CenterSource = "builtin" | "external_api" | "external_link";
type CenterStatus = "published" | "disabled";
type RefItem = { id: string; name: string };

type AgentCenterItem = {
  rowKind: "agent";
  id: string;
  agentId: string;
  draftId: string | null;
  agentCode: string | null;
  name: string;
  description: string;
  source: CenterSource;
  status: CenterStatus;
  draftStatus: "draft" | "testing" | "published" | "archived" | null;
  platform: string;
  externalUrl: string;
  categoryIds: string[];
  categories: { id: string; name: string; iconUrl: string | null }[];
  knowledgeBases: RefItem[];
  workflows: RefItem[];
  knowledgeBaseCount: number;
  workflowRefCount: number;
  conversationCount: number;
  updatedAt: string;
  canEdit: boolean;
  canEnable: boolean;
  canDelete: boolean;
};

type AgentCenterResponse = {
  data: AgentCenterItem[];
  pagination: { page: number; pageSize: number; total: number };
  stats: {
    total: number;
    published: number;
    disabled: number;
    workflowReferenced: number;
    ungrouped: number;
  };
  categories: { id: string; name: string; iconUrl: string | null; count: number }[];
  platforms: string[];
};

type Permission = { id: string; scope_type: string; scope_id: string | null; scope_label: string };
type Tenant = { id: string; code: string; name: string };
type Dept = { id: string; name: string; tenant_code: string };
type Team = { id: string; name: string; dept_id: string };
type CategoryDisplayConfig = {
  category_id: string;
  category_name: string;
  is_auto: boolean;
  is_manual: boolean;
  is_hidden: boolean;
};

const UNGROUPED_CATEGORY_ID = "__ungrouped__";

const SCOPE_TYPE_LABELS: Record<string, string> = {
  all: "全部用户",
  org: "组织",
  dept: "部门",
  team: "小组",
  user: "用户",
  user_type: "用户类型",
  group: "分组",
};

const SOURCE_META: Record<CenterSource, { label: string; className: string }> = {
  builtin: {
    label: "平台搭建",
    className: "bg-sky-50 text-sky-700 border-sky-100",
  },
  external_api: {
    label: "外部接入",
    className: "bg-violet-50 text-violet-700 border-violet-100",
  },
  external_link: {
    label: "外链",
    className: "bg-orange-50 text-orange-700 border-orange-100",
  },
};

const EMPTY_RESPONSE: AgentCenterResponse = {
  data: [],
  pagination: { page: 1, pageSize: 10, total: 0 },
  stats: { total: 0, published: 0, disabled: 0, workflowReferenced: 0, ungrouped: 0 },
  categories: [],
  platforms: [],
};

function platformLabel(value: string) {
  const map: Record<string, string> = {
    builder: "平台搭建",
    external: "外链",
    coze: "Coze",
    dify: "Dify",
    openai: "OpenAI",
    zhipu: "智谱",
    yuanqi: "元器",
    qingyan: "清言",
    anthropic: "Anthropic",
  };
  return map[value] ?? value;
}

function editHref(item: AgentCenterItem) {
  if (item.draftId) return `/admin/agent-builder/${item.draftId}`;
  return `/admin/agent-center/${item.agentId}`;
}

function displayCode(item: AgentCenterItem) {
  if (item.agentCode) return item.agentCode;
  return "AGENT";
}

export function AgentCenterWorkbench() {
  const router = useRouter();
  const { toast } = useToast();
  const [focusAgentId, setFocusAgentId] = useState("");
  const [result, setResult] = useState<AgentCenterResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [platform, setPlatform] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openMoreId, setOpenMoreId] = useState<string | null>(null);
  const [permModal, setPermModal] = useState<AgentCenterItem | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [newScopeType, setNewScopeType] = useState("org");
  const [newScopeId, setNewScopeId] = useState("");
  const [addingPerm, setAddingPerm] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [userGroups, setUserGroups] = useState<{ id: string; name: string }[]>([]);
  const [displayModal, setDisplayModal] = useState<AgentCenterItem | null>(null);
  const [displayConfig, setDisplayConfig] = useState<CategoryDisplayConfig[]>([]);
  const [displayLoading, setDisplayLoading] = useState(false);
  const [dataModal, setDataModal] = useState<AgentCenterItem | null>(null);

  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus")?.trim() ?? "";
    setFocusAgentId(focus);
    if (!focus) return;
    setQuery(focus);
    setDebouncedQuery(focus);
    setPage(1);
  }, []);

  useEffect(() => {
    if (!focusAgentId) return;
    setQuery(focusAgentId);
    setDebouncedQuery(focusAgentId);
    setPage(1);
  }, [focusAgentId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!openMoreId) return;
    const close = () => setOpenMoreId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMoreId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (source) params.set("source", source);
      if (status) params.set("status", status);
      if (categoryId) params.set("categoryId", categoryId);
      if (platform) params.set("platform", platform);
      const res = await fetch(`/api/admin/agent-center?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setResult(data as AgentCenterResponse);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setError(msg);
      setResult(EMPTY_RESPONSE);
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }, [categoryId, debouncedQuery, page, pageSize, platform, source, status]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize));
  const hasFilters = query || source || status || categoryId || platform;

  const platformOptions = useMemo(() => {
    return result.platforms.map((p) => ({ value: p, label: platformLabel(p) }));
  }, [result.platforms]);

  function openBuilderDrafts() {
    setCreateOpen(false);
    router.push("/admin/agent-builder");
  }

  function openAgentEditor(type: "external_link" | "external_api") {
    setCreateOpen(false);
    router.push(`/admin/agent-center/new?type=${type}`);
  }

  async function toggleAgent(item: AgentCenterItem) {
    if (!item.agentId) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/admin/agents/${item.agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: item.status === "disabled" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "切换失败");
      toast(item.status === "disabled" ? "已启用" : "已停用");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "切换失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeItem(item: AgentCenterItem) {
    if (!confirm(`确认删除智能体「${item.name}」？`)) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/admin/agents/${item.agentId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(data.used_by)) {
          throw new Error(`被 ${data.used_by.length} 个工作流引用，无法删除`);
        }
        throw new Error(data.error ?? "删除失败");
      }
      toast("已删除");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "删除失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function refreshPerms(item = permModal) {
    if (!item) return;
    const data = await fetch(`/api/admin/resource-permissions?resource_type=agent&resource_id=${item.agentId}`)
      .then((r) => r.json())
      .catch(() => []);
    setPermissions(Array.isArray(data) ? data : []);
  }

  async function openPermModal(item: AgentCenterItem) {
    setOpenMoreId(null);
    setPermModal(item);
    setPermLoading(true);
    setNewScopeType("org");
    setNewScopeId("");
    try {
      const permsPromise = fetch(`/api/admin/resource-permissions?resource_type=agent&resource_id=${item.agentId}`)
        .then((r) => r.json())
        .catch(() => []);
      const needOrgData = tenants.length === 0 && depts.length === 0 && teams.length === 0 && userGroups.length === 0;
      if (needOrgData) {
        const [permsData, tenantsData, deptsData, teamsData, groupsData] = await Promise.all([
          permsPromise,
          fetch("/api/admin/tenants").then((r) => r.json()).then((d) => d.data ?? d).catch(() => []),
          fetch("/api/admin/departments").then((r) => r.json()).then((d) => d.data ?? d).catch(() => []),
          fetch("/api/admin/teams").then((r) => r.json()).then((d) => d.data ?? d).catch(() => []),
          fetch("/api/admin/user-groups").then((r) => r.json()).then((d) => d.data ?? d).catch(() => []),
        ]);
        setPermissions(Array.isArray(permsData) ? permsData : []);
        setTenants(Array.isArray(tenantsData) ? tenantsData : []);
        setDepts(Array.isArray(deptsData) ? deptsData : []);
        setTeams(Array.isArray(teamsData) ? teamsData : []);
        setUserGroups(Array.isArray(groupsData) ? groupsData : []);
      } else {
        const permsData = await permsPromise;
        setPermissions(Array.isArray(permsData) ? permsData : []);
      }
    } finally {
      setPermLoading(false);
    }
  }

  async function deletePerm(permId: string) {
    await fetch("/api/admin/resource-permissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: permId }),
    });
    await refreshPerms();
  }

  async function addPerm() {
    if (!permModal) return;
    if (newScopeType !== "all" && !newScopeId) return;
    setAddingPerm(true);
    try {
      const res = await fetch("/api/admin/resource-permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType: "agent",
          resourceId: permModal.agentId,
          scopeType: newScopeType,
          scopeId: newScopeType === "all" ? null : newScopeId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "添加失败");
      setNewScopeId("");
      await refreshPerms();
      await load();
      toast("权限已添加");
    } catch (e) {
      toast(e instanceof Error ? e.message : "添加失败", "error");
    } finally {
      setAddingPerm(false);
    }
  }

  async function openDisplay(item: AgentCenterItem) {
    setOpenMoreId(null);
    setDisplayModal(item);
    setDisplayLoading(true);
    try {
      const data = await fetch(`/api/admin/category-display?agentId=${item.agentId}`)
        .then((r) => r.json())
        .catch(() => []);
      setDisplayConfig(Array.isArray(data) ? data : []);
    } finally {
      setDisplayLoading(false);
    }
  }

  async function refreshDisplay(agentId: string) {
    const data = await fetch(`/api/admin/category-display?agentId=${agentId}`).then((r) => r.json()).catch(() => []);
    setDisplayConfig(Array.isArray(data) ? data : []);
  }

  async function toggleDisplayConfig(agentId: string, categoryId: string, field: "isManual" | "isHidden", currentValue: boolean) {
    const res = await fetch("/api/admin/category-display", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, categoryId, [field]: !currentValue }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error ?? "保存失败", "error");
      return;
    }
    await refreshDisplay(agentId);
  }

  function markFilterUpdating() {
    if (hasLoaded) setLoading(true);
  }

  function selectCategory(next: string) {
    if (next !== categoryId) markFilterUpdating();
    setCategoryId(next);
    setPage(1);
  }

  function clearFilters() {
    if (hasFilters) markFilterUpdating();
    setQuery("");
    setDebouncedQuery("");
    setSource("");
    setStatus("");
    setCategoryId("");
    setPlatform("");
    setPage(1);
  }

  return (
    <div className="max-w-[1500px] space-y-6">
      <PageHeader
        icon={<Bot size={20} />}
        title="智能体管理"
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus size={16} /> 新增智能体
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 items-start xl:h-[calc(100vh-188px)] xl:min-h-0 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card padding="none" className="overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Tag size={16} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">标签分组</h2>
          </div>
          <div className="p-3 space-y-1 overflow-y-auto xl:min-h-0 xl:flex-1">
            <button
              onClick={() => selectCategory("")}
              className={`w-full h-9 rounded-[8px] px-3 text-sm flex items-center justify-between ${
                categoryId === "" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span>全部智能体</span>
              <span>{result.stats.total}</span>
            </button>
            <button
              onClick={() => selectCategory(UNGROUPED_CATEGORY_ID)}
              className={`w-full h-9 rounded-[8px] px-3 text-sm flex items-center justify-between ${
                categoryId === UNGROUPED_CATEGORY_ID ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span>未分组智能体</span>
              <span>{result.stats.ungrouped}</span>
            </button>
            {result.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => selectCategory(cat.id)}
                className={`w-full min-h-9 rounded-[8px] px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                  categoryId === cat.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="truncate text-left">{cat.name}</span>
                <span className="shrink-0">{cat.count}</span>
              </button>
            ))}
            {result.categories.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-400">暂无标签</p>
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-6 xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-6 xl:space-y-0">
          <Card padding="md" className="space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              <div className="w-full sm:w-[280px]">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索智能体名称、编号或标签"
                  icon={<Search size={16} className="text-gray-500" />}
                  className="border-gray-300 bg-gray-50/80 shadow-sm placeholder:text-gray-500 hover:border-gray-400 focus:bg-white"
                />
              </div>
              <select
                value={source}
                onChange={(e) => {
                  if (e.target.value !== source) markFilterUpdating();
                  setSource(e.target.value);
                  setPage(1);
                }}
                className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
              >
                <option value="">全部类型</option>
                <option value="builtin">平台搭建</option>
                <option value="external_api">外部接入</option>
                <option value="external_link">外链跳转</option>
              </select>
              <select
                value={status}
                onChange={(e) => {
                  if (e.target.value !== status) markFilterUpdating();
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
              >
                <option value="">全部状态</option>
                <option value="published">已发布</option>
                <option value="disabled">已停用</option>
              </select>
              <select
                value={platform}
                onChange={(e) => {
                  if (e.target.value !== platform) markFilterUpdating();
                  setPlatform(e.target.value);
                  setPage(1);
                }}
                className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
              >
                <option value="">全部平台</option>
                {platformOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              {loading && hasLoaded && <span className="text-xs text-gray-400">更新中...</span>}
              {hasFilters && (
                <button onClick={clearFilters} className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2">
                  <X size={13} /> 清除
                </button>
              )}
            </div>
          </Card>

          <Card padding="none" className="overflow-hidden xl:flex xl:min-h-0 xl:flex-col">

          {loading && !hasLoaded ? (
            <div className="p-6 space-y-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-50 rounded-[10px] animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="py-16 text-center text-gray-400 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:items-center xl:justify-center">
              <Bot size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm mb-3">{error}</p>
              <Button variant="outline" onClick={load}>
                <RotateCcw size={15} /> 重试
              </Button>
            </div>
          ) : result.data.length === 0 ? (
            <div className="py-16 text-center text-gray-400 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:items-center xl:justify-center">
              <Bot size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm">暂无符合条件的智能体</p>
            </div>
          ) : (
            <div className="relative overflow-x-auto xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
              {loading && hasLoaded && (
                <div className="absolute inset-0 z-20 flex items-start justify-center bg-white/60 pt-16 backdrop-blur-[1px]">
                  <div className="inline-flex items-center gap-2 rounded-full border border-gray-100 bg-white px-3 py-1.5 text-xs text-gray-500 shadow-sm">
                    <Loader2 size={13} className="animate-spin" />
                    更新中
                  </div>
                </div>
              )}
              <table className="w-full shrink-0 table-fixed text-sm">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[20%]" />
                  <col className="w-[16%]" />
                  <col className="w-[20%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead className="border-b border-gray-200 bg-[#fafbfc]">
                  <tr>
                    {(["编号/名称", "标签", "类型/平台", "数据", "操作"] as const).map((h) => (
                      <th
                        key={h}
                        className={`px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider ${
                          h === "编号/名称" ? "text-left" : "text-center"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-[30%]" />
                    <col className="w-[20%]" />
                    <col className="w-[16%]" />
                    <col className="w-[20%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <tbody className="divide-y divide-gray-50">
                    {result.data.map((item) => {
                      const sourceMeta = SOURCE_META[item.source];
                      const busy = busyId === item.id;
                      return (
                        <tr
                          key={item.id}
                          className={`hover:bg-gray-50/50 transition-colors ${
                            focusAgentId && item.agentId === focusAgentId ? "bg-[#002FA7]/5 ring-2 ring-[#002FA7] ring-inset" : ""
                          }`}
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                                item.source === "external_link"
                                  ? "bg-orange-50"
                                  : item.source === "external_api"
                                    ? "bg-violet-50"
                                    : "bg-[#002FA7]/8"
                              }`}>
                                {item.source === "external_link"
                                  ? <ExternalLink size={16} className="text-orange-500" />
                                  : item.source === "external_api"
                                    ? <Plug size={16} className="text-violet-600" />
                                    : <Bot size={18} className="text-[#002FA7]" />}
                              </div>
                              <div className="min-w-0">
                                <Link href={editHref(item)} className="font-medium text-gray-800 hover:text-[#002FA7] truncate block">
                                  {item.name}
                                </Link>
                                <code className="mt-0.5 block text-[10px] text-gray-400 font-mono">{displayCode(item)}</code>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            {item.categories.length > 0 ? (
                              <div className="flex flex-wrap items-center justify-center gap-1">
                                {item.categories.map((c) => (
                                  <span key={c.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 max-w-[120px]">
                                    <Tag size={10} className="shrink-0" />
                                    <span className="truncate">{c.name}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="flex justify-center">
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">未设置标签</span>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${sourceMeta.className}`}>
                                {sourceMeta.label}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-gray-500">
                              <button
                                type="button"
                                onClick={() => setDataModal(item)}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 transition-colors hover:border-[#002FA7]/25 hover:bg-[#002FA7]/5 hover:text-[#002FA7]"
                                title="查看关联知识库"
                              >
                                <Library size={11} /> 知识库 {item.knowledgeBaseCount}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDataModal(item)}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 transition-colors hover:border-[#002FA7]/25 hover:bg-[#002FA7]/5 hover:text-[#002FA7]"
                                title="查看工作流引用"
                              >
                                <GitBranch size={11} /> 工作流 {item.workflowRefCount}
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-center gap-1">
                              {item.canEdit && (
                                <Link
                                  href={editHref(item)}
                                  className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                  title="编辑"
                                  aria-label="编辑"
                                >
                                  <Edit2 size={14} />
                                </Link>
                              )}
                              {item.canEnable && (
                                <button
                                  onClick={() => toggleAgent(item)}
                                  disabled={busy}
                                  className={`p-1.5 rounded-[8px] transition-colors disabled:opacity-50 ${
                                    item.status === "disabled"
                                      ? "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                      : "text-green-600 hover:bg-green-50"
                                  }`}
                                  title={item.status === "disabled" ? "启用" : "停用"}
                                  aria-label={item.status === "disabled" ? "启用" : "停用"}
                                >
                                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                                </button>
                              )}
                              {item.canDelete && (
                                <button
                                  onClick={() => removeItem(item)}
                                  disabled={busy}
                                  className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                                  title="删除"
                                  aria-label="删除"
                                >
                                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                </button>
                              )}
                              {item.canEdit && (
                                <div className="relative" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => setOpenMoreId((prev) => prev === item.id ? null : item.id)}
                                    className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                    title="更多"
                                    aria-label="更多"
                                  >
                                    <MoreHorizontal size={15} />
                                  </button>
                                  {openMoreId === item.id && (
                                    <div className="absolute right-0 top-8 z-30 w-40 overflow-hidden rounded-[12px] border border-gray-100 bg-white py-1 shadow-lg">
                                      {item.source === "external_api" && (
                                        <Link
                                          href={`${editHref(item)}#api-config`}
                                          onClick={() => setOpenMoreId(null)}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                                        >
                                          <Key size={14} className="text-gray-400" />
                                          API 配置
                                        </Link>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => openPermModal(item)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                                      >
                                        <Settings2 size={14} className="text-gray-400" />
                                        权限设置
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openDisplay(item)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50"
                                      >
                                        <LayoutGrid size={14} className="text-gray-400" />
                                        标签展示
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              {!item.canEdit && !item.canEnable && !item.canDelete && (
                                <span className="text-xs text-gray-300">仅可查看</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex shrink-0 items-center justify-end border-t border-gray-100 bg-white px-5 py-3 text-sm text-gray-500">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="上一页"
                title="上一页"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-16 text-center">{page} / {totalPages}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="下一页"
                title="下一页"
              >
                <ChevronRight size={16} />
              </Button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="h-8 rounded-[8px] border border-gray-200 bg-white px-2 text-xs text-gray-600 focus:outline-none focus:border-[#002FA7]"
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
              </select>
            </div>
          </div>
          </Card>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-[20px] bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">新增智能体</h2>
                <p className="mt-1 text-sm text-gray-500">选择创建方式</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-[8px] p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={openBuilderDrafts}
                className="group flex min-h-[156px] flex-col items-start rounded-[16px] border border-gray-200 bg-white p-4 text-left transition-all hover:border-[#002FA7]/40 hover:bg-[#002FA7]/5"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#002FA7]/8 text-[#002FA7]">
                  <Bot size={18} />
                </span>
                <span className="font-semibold text-gray-900">平台搭建</span>
                <span className="mt-1 text-xs leading-5 text-gray-500">在本平台完成智能体创建、配置与发布</span>
              </button>
              <button
                type="button"
                onClick={() => openAgentEditor("external_link")}
                className="group flex min-h-[156px] flex-col items-start rounded-[16px] border border-gray-200 bg-white p-4 text-left transition-all hover:border-orange-200 hover:bg-orange-50/50"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px] bg-orange-50 text-orange-500">
                  <ExternalLink size={18} />
                </span>
                <span className="font-semibold text-gray-900">外链跳转</span>
                <span className="mt-1 text-xs leading-5 text-gray-500">适用于无法获取 API 的智能体，仅配置访问链接</span>
              </button>
              <button
                type="button"
                onClick={() => openAgentEditor("external_api")}
                className="group flex min-h-[156px] flex-col items-start rounded-[16px] border border-gray-200 bg-white p-4 text-left transition-all hover:border-violet-200 hover:bg-violet-50/50"
              >
                <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-[12px] bg-violet-50 text-violet-600">
                  <Plug size={18} />
                </span>
                <span className="font-semibold text-gray-900">外部接入</span>
                <span className="mt-1 text-xs leading-5 text-gray-500">将 Coze 等外部平台搭建的智能体通过 API 接入本平台</span>
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {permModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-[20px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">权限设置</h2>
                <p className="mt-1 text-sm text-gray-500">{permModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPermModal(null)}
                className="rounded-[8px] p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">当前权限</p>
              {permLoading ? (
                <div className="h-10 animate-pulse rounded-[10px] bg-gray-50" />
              ) : permissions.length === 0 ? (
                <div className="rounded-[10px] border border-amber-100 bg-amber-50 p-3 text-sm text-amber-700">
                  暂无权限配置
                </div>
              ) : (
                <div className="space-y-2">
                  {permissions.map((perm) => (
                    <div key={perm.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-gray-50 p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 rounded-full bg-[#e8eeff] px-2 py-0.5 text-xs font-medium text-[#002FA7]">
                          {SCOPE_TYPE_LABELS[perm.scope_type] ?? perm.scope_type}
                        </span>
                        <span className="truncate text-sm text-gray-700">{perm.scope_label}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => deletePerm(perm.id)}
                        className="shrink-0 rounded-[8px] p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                        aria-label="删除权限"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">添加权限</p>
              <div className="mb-2 flex flex-wrap gap-2">
                <select
                  value={newScopeType}
                  onChange={(e) => {
                    setNewScopeType(e.target.value);
                    setNewScopeId("");
                  }}
                  className="h-9 shrink-0 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none"
                >
                  <option value="all">全部用户</option>
                  <option value="user_type">用户类型</option>
                  <option value="org">按组织</option>
                  <option value="dept">按部门</option>
                  <option value="team">按小组</option>
                  <option value="user">指定用户 ID</option>
                  <option value="group">按分组</option>
                </select>
                {newScopeType === "group" && (
                  <select value={newScopeId} onChange={(e) => setNewScopeId(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none">
                    <option value="">请选择分组</option>
                    {userGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                )}
                {newScopeType === "user_type" && (
                  <select value={newScopeId} onChange={(e) => setNewScopeId(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none">
                    <option value="">请选择</option>
                    <option value="personal">个人用户</option>
                    <option value="organization">组织用户</option>
                  </select>
                )}
                {newScopeType === "org" && (
                  <select value={newScopeId} onChange={(e) => setNewScopeId(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none">
                    <option value="">请选择组织</option>
                    {tenants.map((tenant) => <option key={tenant.code} value={tenant.code}>{tenant.name} ({tenant.code})</option>)}
                  </select>
                )}
                {newScopeType === "dept" && (
                  <select value={newScopeId} onChange={(e) => setNewScopeId(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none">
                    <option value="">请选择部门</option>
                    {depts.map((dept) => <option key={dept.id} value={dept.id}>{dept.name} ({dept.tenant_code})</option>)}
                  </select>
                )}
                {newScopeType === "team" && (
                  <select value={newScopeId} onChange={(e) => setNewScopeId(e.target.value)} className="h-9 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm focus:border-[#002FA7] focus:outline-none">
                    <option value="">请选择小组</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                )}
                {newScopeType === "user" && (
                  <input
                    value={newScopeId}
                    onChange={(e) => setNewScopeId(e.target.value)}
                    placeholder="粘贴用户 ID"
                    className="h-9 flex-1 rounded-[8px] border border-gray-200 px-3 text-sm focus:border-[#002FA7] focus:outline-none"
                  />
                )}
              </div>
              <Button className="w-full" onClick={addPerm} loading={addingPerm} disabled={newScopeType !== "all" && !newScopeId}>
                添加权限
              </Button>
            </div>
          </div>
        </div>
      )}

      {displayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900">标签展示配置</h2>
                <p className="mt-1 text-sm text-gray-500">{displayModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDisplayModal(null)}
                className="rounded-[8px] p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            {displayLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-[10px] bg-gray-50" />)}
              </div>
            ) : displayConfig.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">暂无标签</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {displayConfig.map((cfg) => (
                  <div key={cfg.category_id} className="flex items-center gap-3 rounded-[12px] bg-gray-50 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800">{cfg.category_name}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {cfg.is_auto && <span className="mr-2 text-[#002FA7]">自动同步</span>}
                        {cfg.is_manual && <span className="mr-2 text-green-600">手动添加</span>}
                        {cfg.is_hidden && <span className="text-red-500">已隐藏</span>}
                        {!cfg.is_auto && !cfg.is_manual && !cfg.is_hidden && <span>未展示</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleDisplayConfig(displayModal.agentId, cfg.category_id, "isManual", cfg.is_manual)}
                        title={cfg.is_manual ? "取消手动添加" : "手动添加到此标签"}
                        className={`rounded-[8px] p-1.5 transition-colors ${cfg.is_manual ? "bg-green-100 text-green-600" : "text-gray-400 hover:bg-gray-200"}`}
                      >
                        <PlusCircle size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDisplayConfig(displayModal.agentId, cfg.category_id, "isHidden", cfg.is_hidden)}
                        title={cfg.is_hidden ? "取消隐藏" : "在此标签中隐藏"}
                        className={`rounded-[8px] p-1.5 transition-colors ${cfg.is_hidden ? "bg-red-100 text-red-500" : "text-gray-400 hover:bg-gray-200"}`}
                      >
                        {cfg.is_hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button variant="ghost" onClick={() => setDisplayModal(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}

      {dataModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-[20px] bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">数据引用</h2>
                <p className="mt-1 truncate text-sm text-gray-500">{dataModal.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDataModal(null)}
                className="rounded-[8px] p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-[14px] border border-gray-100 bg-gray-50/70 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Library size={15} className="text-gray-500" />
                  关联知识库
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
                    {dataModal.knowledgeBases.length}
                  </span>
                </div>
                {dataModal.knowledgeBases.length === 0 ? (
                  <p className="rounded-[10px] bg-white px-3 py-6 text-center text-sm text-gray-400">暂无关联知识库</p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {dataModal.knowledgeBases.map((kb) => (
                      <Link
                        key={kb.id}
                        href={`/admin/knowledge-bases/${encodeURIComponent(kb.id)}`}
                        onClick={() => setDataModal(null)}
                        className="flex items-center gap-2 rounded-[10px] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-[#002FA7]/8 hover:text-[#002FA7]"
                        title={`打开知识库：${kb.name}`}
                      >
                        <Library size={13} className="shrink-0 text-gray-400" />
                        <span className="truncate">{kb.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-[14px] border border-gray-100 bg-gray-50/70 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <GitBranch size={15} className="text-gray-500" />
                  工作流调用
                  <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
                    {dataModal.workflows.length}
                  </span>
                </div>
                {dataModal.workflows.length === 0 ? (
                  <p className="rounded-[10px] bg-white px-3 py-6 text-center text-sm text-gray-400">暂无工作流调用</p>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {dataModal.workflows.map((workflow) => (
                      <Link
                        key={workflow.id}
                        href={`/admin/workflows?focus=${encodeURIComponent(workflow.id)}&fromAgent=${encodeURIComponent(dataModal.agentId)}&pageSize=100`}
                        onClick={() => setDataModal(null)}
                        className="flex items-center gap-2 rounded-[10px] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-[#002FA7]/8 hover:text-[#002FA7]"
                        title={`打开工作流：${workflow.name}`}
                      >
                        <GitBranch size={13} className="shrink-0 text-gray-400" />
                        <span className="truncate">{workflow.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
