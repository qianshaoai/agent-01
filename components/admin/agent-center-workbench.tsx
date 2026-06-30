"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bot,
  Copy,
  Edit2,
  ExternalLink,
  GitBranch,
  Library,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";

type CenterSource = "builtin" | "external_api" | "external_link";
type CenterStatus = "published" | "draft" | "disabled";

type AgentCenterItem = {
  rowKind: "agent" | "draft";
  id: string;
  agentId: string | null;
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
  knowledgeBaseCount: number;
  workflowRefCount: number;
  conversationCount: number;
  updatedAt: string;
  canEdit: boolean;
  canDuplicate: boolean;
  canEnable: boolean;
  canDelete: boolean;
};

type AgentCenterResponse = {
  data: AgentCenterItem[];
  pagination: { page: number; pageSize: number; total: number };
  stats: {
    total: number;
    published: number;
    draft: number;
    disabled: number;
    workflowReferenced: number;
  };
  categories: { id: string; name: string; iconUrl: string | null; count: number }[];
  platforms: string[];
};

const SOURCE_META: Record<CenterSource, { label: string; className: string }> = {
  builtin: {
    label: "本平台",
    className: "bg-sky-50 text-sky-700 border-sky-100",
  },
  external_api: {
    label: "外部接入",
    className: "bg-violet-50 text-violet-700 border-violet-100",
  },
  external_link: {
    label: "外链跳转",
    className: "bg-orange-50 text-orange-700 border-orange-100",
  },
};

const STATUS_META: Record<CenterStatus, { label: string; className: string }> = {
  published: {
    label: "已发布",
    className: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  draft: {
    label: "草稿",
    className: "bg-amber-50 text-amber-700 border-amber-100",
  },
  disabled: {
    label: "已停用",
    className: "bg-rose-50 text-rose-700 border-rose-100",
  },
};

const DRAFT_STATUS_LABEL: Record<NonNullable<AgentCenterItem["draftStatus"]>, string> = {
  draft: "草稿",
  testing: "测试中",
  published: "已发布",
  archived: "已归档",
};

const EMPTY_RESPONSE: AgentCenterResponse = {
  data: [],
  pagination: { page: 1, pageSize: 10, total: 0 },
  stats: { total: 0, published: 0, draft: 0, disabled: 0, workflowReferenced: 0 },
  categories: [],
  platforms: [],
};

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function platformLabel(value: string) {
  const map: Record<string, string> = {
    builder: "本平台",
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
  if (item.agentId) return `/admin/agents?focus=${item.agentId}`;
  return "/admin/agents";
}

export function AgentCenterWorkbench() {
  const router = useRouter();
  const { toast } = useToast();
  const createGuard = useSubmitGuard();
  const [result, setResult] = useState<AgentCenterResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, source, status, categoryId, platform, pageSize]);

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

  async function createDraft() {
    await createGuard.submit(async (idempotencyKey) => {
      try {
        const res = await fetch("/api/admin/agent-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ name: "未命名智能体" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "创建失败");
        router.push(`/admin/agent-builder/${data.id}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "创建失败", "error");
      }
    });
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

  async function duplicateDraft(item: AgentCenterItem) {
    if (!item.draftId) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/admin/agent-drafts/${item.draftId}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "复制失败");
      toast("草稿已复制");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "复制失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeItem(item: AgentCenterItem) {
    const label = item.rowKind === "agent" ? "智能体" : "草稿";
    if (!confirm(`确认删除${label}「${item.name}」？`)) return;
    setBusyId(item.id);
    try {
      const url = item.rowKind === "agent" && item.agentId
        ? `/api/admin/agents/${item.agentId}`
        : item.draftId
          ? `/api/admin/agent-drafts/${item.draftId}`
          : "";
      if (!url) throw new Error("缺少资源 ID");
      const res = await fetch(url, { method: "DELETE" });
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

  function clearFilters() {
    setQuery("");
    setDebouncedQuery("");
    setSource("");
    setStatus("");
    setCategoryId("");
    setPlatform("");
  }

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        icon={<Bot size={20} />}
        title="智能体中心"
        badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {result.pagination.total} 个</span>}
        actions={
          <Button onClick={createDraft} loading={createGuard.loading} className="gap-1.5">
            <Plus size={16} /> 新增智能体
          </Button>
        }
      />

      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="w-full sm:w-[280px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索智能体名称、编号或标签"
              icon={<Search size={16} />}
            />
          </div>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
          >
            <option value="">全部类型</option>
            <option value="builtin">本平台</option>
            <option value="external_api">外部接入</option>
            <option value="external_link">外链跳转</option>
          </select>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
          >
            <option value="">全部标签</option>
            {result.categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
          >
            <option value="">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
            <option value="disabled">已停用</option>
          </select>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="h-10 border border-gray-200 rounded-[10px] px-3.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
          >
            <option value="">全部平台</option>
            {platformOptions.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-[12px] text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2">
              <X size={13} /> 清除
            </button>
          )}
          <span className="ml-auto text-[12px] text-gray-500">
            {result.pagination.total} / {result.stats.total} 个
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">已发布 {result.stats.published}</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">草稿 {result.stats.draft}</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">已停用 {result.stats.disabled}</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">工作流引用 {result.stats.workflowReferenced}</span>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">

          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-50 rounded-[10px] animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="py-16 text-center text-gray-400">
              <Bot size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm mb-3">{error}</p>
              <Button variant="outline" onClick={load}>
                <RotateCcw size={15} /> 重试
              </Button>
            </div>
          ) : result.data.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Bot size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm">暂无符合条件的智能体</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-sticky-head table-fixed">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                  <col className="w-[20%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr>
                    {(["编号/名称", "标签", "类型/状态", "数据", "操作"] as const).map((h) => (
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
                <tbody className="divide-y divide-gray-50">
                  {result.data.map((item) => {
                    const sourceMeta = SOURCE_META[item.source];
                    const statusMeta = STATUS_META[item.status];
                    const busy = busyId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                              item.source === "external_link" ? "bg-orange-50" : "bg-[#002FA7]/8"
                            }`}>
                              {item.source === "external_link"
                                ? <ExternalLink size={16} className="text-orange-500" />
                                : <Bot size={18} className="text-[#002FA7]" />}
                            </div>
                            <div className="min-w-0">
                              <Link href={editHref(item)} className="font-medium text-gray-800 hover:text-[#002FA7] truncate block">
                                {item.name}
                              </Link>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400 font-mono">
                                <span>{item.agentCode ?? (item.draftStatus ? DRAFT_STATUS_LABEL[item.draftStatus] : "DRAFT")}</span>
                                {item.description && (
                                  <span className="truncate font-sans text-[11px]" title={item.description}>
                                    {item.description}
                                  </span>
                                )}
                              </div>
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
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">
                              {platformLabel(item.platform)}
                            </span>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </div>
                          <p className="mt-1 text-center text-[11px] text-gray-400">
                            {formatDate(item.updatedAt)}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-gray-500">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200" title="关联知识库">
                              <Library size={11} /> 知识库 {item.knowledgeBaseCount}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200" title="工作流引用">
                              <GitBranch size={11} /> 工作流 {item.workflowRefCount}
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200" title="会话次数">
                              <MessageSquare size={11} /> 会话 {item.conversationCount}
                            </span>
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
                            {item.canDuplicate && (
                              <button
                                onClick={() => duplicateDraft(item)}
                                disabled={busy}
                                className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-[#002FA7] transition-colors disabled:opacity-50"
                                title="复制"
                                aria-label="复制"
                              >
                                {busy ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                              </button>
                            )}
                            {item.rowKind === "agent" && item.canEnable && (
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
                            {!item.canEdit && !item.canDuplicate && !item.canEnable && !item.canDelete && (
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
          )}

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 text-sm text-gray-500">
            <div className="flex items-center gap-3">
              <span>共 {result.pagination.total} 条</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-8 rounded-[8px] border border-gray-200 bg-white px-2 text-xs text-gray-600 focus:outline-none focus:border-[#002FA7]"
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <span className="min-w-16 text-center">{page} / {totalPages}</span>
              <Button variant="ghost" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                下一页
              </Button>
            </div>
          </div>
      </Card>
    </div>
  );
}
