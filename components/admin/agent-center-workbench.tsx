"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Bot,
  Boxes,
  Copy,
  Edit2,
  GitBranch,
  Library,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
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

function statCards(data: AgentCenterResponse["stats"]) {
  return [
    { label: "总数", value: data.total, icon: Bot, className: "bg-slate-50 text-slate-700 border-slate-100" },
    { label: "已发布", value: data.published, icon: MessageSquare, className: "bg-emerald-50 text-emerald-700 border-emerald-100" },
    { label: "草稿", value: data.draft, icon: Edit2, className: "bg-amber-50 text-amber-700 border-amber-100" },
    { label: "已停用", value: data.disabled, icon: Ban, className: "bg-rose-50 text-rose-700 border-rose-100" },
    { label: "被工作流引用", value: data.workflowReferenced, icon: GitBranch, className: "bg-violet-50 text-violet-700 border-violet-100" },
  ];
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
    <div className="max-w-[1500px] space-y-5">
      <PageHeader
        icon={<Bot size={20} />}
        title="智能体中心"
        subtitle={`统一查看、筛选和维护智能体。共 ${result.stats.total} 个智能体`}
        actions={
          <Button onClick={createDraft} loading={createGuard.loading} className="gap-1.5">
            <Plus size={16} /> 新增智能体
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {statCards(result.stats).map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} padding="sm" className="border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-950">{card.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-[8px] border flex items-center justify-center ${card.className}`}>
                  <Icon size={18} />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_270px] gap-4 items-start">
        <Card padding="none" className="overflow-hidden border border-gray-100 shadow-sm">
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_150px_150px_150px_150px_auto] gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索智能体名称、编号或标签"
                icon={<Search size={16} />}
              />
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="h-10 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              >
                <option value="">全部类型</option>
                <option value="builtin">本平台</option>
                <option value="external_api">外部接入</option>
                <option value="external_link">外链跳转</option>
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-10 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              >
                <option value="">全部状态</option>
                <option value="published">已发布</option>
                <option value="draft">草稿</option>
                <option value="disabled">已停用</option>
              </select>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="h-10 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              >
                <option value="">全部平台</option>
                {platformOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-10 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              >
                <option value={10}>10 条/页</option>
                <option value={20}>20 条/页</option>
                <option value={50}>50 条/页</option>
              </select>
              {hasFilters ? (
                <button
                  onClick={clearFilters}
                  className="h-10 px-3 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 inline-flex items-center justify-center gap-1.5"
                >
                  <X size={15} /> 清除
                </button>
              ) : (
                <div className="hidden md:block" />
              )}
            </div>
          </div>

          {loading ? (
            <div className="h-[420px] flex items-center justify-center text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" /> 加载中
            </div>
          ) : error ? (
            <div className="h-[420px] flex flex-col items-center justify-center gap-3 text-gray-500">
              <p>{error}</p>
              <Button variant="outline" onClick={load}>
                <RotateCcw size={15} /> 重试
              </Button>
            </div>
          ) : result.data.length === 0 ? (
            <div className="h-[420px] flex items-center justify-center text-gray-400">
              暂无智能体
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[27%]" />
                  <col className="w-[15%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[10%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">智能体名称</th>
                    <th className="px-4 py-3 text-left font-medium">标签</th>
                    <th className="px-4 py-3 text-left font-medium">状态</th>
                    <th className="px-4 py-3 text-left font-medium">形态 / 平台</th>
                    <th className="px-4 py-3 text-center font-medium">数据</th>
                    <th className="px-4 py-3 text-left font-medium">更新时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.data.map((item) => {
                    const sourceMeta = SOURCE_META[item.source];
                    const statusMeta = STATUS_META[item.status];
                    const busy = busyId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-gray-50/70">
                        <td className="px-4 py-3 align-top">
                          <Link href={editHref(item)} className="font-medium text-gray-950 hover:text-[#002FA7]">
                            {item.name}
                          </Link>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                            <span>{item.agentCode ?? (item.draftStatus ? DRAFT_STATUS_LABEL[item.draftStatus] : "草稿")}</span>
                            {item.description && (
                              <>
                                <span className="text-gray-300">/</span>
                                <span className="truncate" title={item.description}>{item.description}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {item.categories.length === 0 ? (
                            <span className="text-xs text-gray-300">未设置</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {item.categories.slice(0, 2).map((c) => (
                                <span key={c.id} className="inline-flex items-center max-w-[110px] rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                                  <span className="truncate">{c.name}</span>
                                </span>
                              ))}
                              {item.categories.length > 2 && (
                                <span className="text-[11px] text-gray-400">+{item.categories.length - 2}</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusMeta.className}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${sourceMeta.className}`}>
                            {sourceMeta.label}
                          </span>
                          <p className="mt-1 text-xs text-gray-400">{platformLabel(item.platform)}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1" title="关联知识库">
                              <Library size={13} /> {item.knowledgeBaseCount}
                            </span>
                            <span className="inline-flex items-center gap-1" title="工作流引用">
                              <GitBranch size={13} /> {item.workflowRefCount}
                            </span>
                            <span className="inline-flex items-center gap-1" title="会话次数">
                              <MessageSquare size={13} /> {item.conversationCount}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-gray-500">
                          {formatDate(item.updatedAt)}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.canEdit && (
                              <Link
                                href={editHref(item)}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] text-gray-500 hover:bg-gray-100 hover:text-[#002FA7]"
                                title="编辑"
                              >
                                <Edit2 size={15} />
                              </Link>
                            )}
                            {item.canDuplicate && (
                              <button
                                onClick={() => duplicateDraft(item)}
                                disabled={busy}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] text-gray-500 hover:bg-gray-100 hover:text-[#002FA7] disabled:opacity-50"
                                title="复制"
                              >
                                {busy ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                              </button>
                            )}
                            {item.rowKind === "agent" && item.canEnable && (
                              <button
                                onClick={() => toggleAgent(item)}
                                disabled={busy}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] text-gray-500 hover:bg-gray-100 hover:text-[#002FA7] disabled:opacity-50"
                                title={item.status === "disabled" ? "启用" : "停用"}
                              >
                                {busy ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                              </button>
                            )}
                            {item.canDelete && (
                              <button
                                onClick={() => removeItem(item)}
                                disabled={busy}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-[8px] text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                                title="删除"
                              >
                                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                              </button>
                            )}
                            {!item.canEdit && !item.canDuplicate && !item.canEnable && !item.canDelete && (
                              <span className="text-xs text-gray-300">仅查看</span>
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

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
            <span>共 {result.pagination.total} 条</span>
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

        <Card padding="none" className="border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Boxes size={17} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">分组</h2>
          </div>
          <div className="p-3 space-y-1 max-h-[620px] overflow-y-auto">
            <button
              onClick={() => setCategoryId("")}
              className={`w-full h-9 rounded-[8px] px-3 text-sm flex items-center justify-between ${
                categoryId === "" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <span>全部智能体</span>
              <span>{result.stats.total}</span>
            </button>
            {result.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryId(cat.id)}
                className={`w-full min-h-9 rounded-[8px] px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                  categoryId === cat.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span className="truncate text-left">{cat.name}</span>
                <span className="shrink-0">{cat.count}</span>
              </button>
            ))}
            {result.categories.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-400">暂无分组</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
