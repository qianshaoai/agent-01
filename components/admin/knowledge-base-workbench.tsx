"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FileText,
  Globe2,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Search,
  Users,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { KbVisibilityScopeEditor } from "@/components/admin/kb-visibility-scope-editor";
import { useAdminPermissions } from "@/lib/hooks/use-admin-permissions";

type KbDocStatus = "pending" | "indexing" | "done" | "failed";

type KbDocument = {
  id: string;
  filename: string;
  file_type: string;
  status: KbDocStatus;
  chunk_count: number;
  total_chunks: number;
  char_count: number;
  error_msg: string;
  created_at: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  status: "active" | "disabled";
  document_count?: number;
  created_at: string;
  tenant_code: string | null;
  created_by_role?: "super_admin" | "system_admin" | "org_admin" | null;
};

type KbVisibilityScope = {
  scope_type: "all" | "org" | "dept" | "team";
  scope_id: string | null;
};

type VisibilityTeam = { id: string; name: string; dept_id: string };
type VisibilityDept = {
  id: string;
  name: string;
  tenant_code: string;
  teams: VisibilityTeam[];
};
type VisibilityTenant = {
  code: string;
  name: string;
  enabled: boolean;
  departments: VisibilityDept[];
};

type RefAgent = { id: string; name: string };

type AdminMe = {
  role: "super_admin" | "system_admin" | "org_admin";
  tenantCode: string | null;
};

type KnowledgeBaseWorkbenchProps = {
  initialKbId?: string;
};

const PAGE_SIZES = [10, 20, 50];
const READONLY_TITLE = "无写权限或该知识库由上级管理员创建";
const SUPPORTED_FILE_TEXT =
  "支持 pdf / doc / docx / txt / md / csv / xls / xlsx / pptx，单文件 <= 20MB";

const STATUS_META: Record<KbDocStatus, { label: string; className: string }> = {
  pending: { label: "等待索引", className: "bg-gray-100 text-gray-600" },
  indexing: { label: "索引中", className: "bg-blue-50 text-blue-700" },
  done: { label: "已完成", className: "bg-emerald-50 text-emerald-700" },
  failed: { label: "失败", className: "bg-red-50 text-red-700" },
};

const DEFAULT_VISIBILITY: KbVisibilityScope[] = [{ scope_type: "all", scope_id: null }];

function scopeKey(scope: KbVisibilityScope) {
  return `${scope.scope_type}:${scope.scope_id ?? ""}`;
}

function formatDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function syncKnowledgeBaseUrl(kbId: string | null) {
  if (typeof window === "undefined") return;
  const target = kbId
    ? `/admin/knowledge-bases/${encodeURIComponent(kbId)}`
    : "/admin/knowledge-bases";
  if (window.location.pathname !== target) {
    window.history.replaceState(null, "", target);
  }
}

function normalizeVisibilityScopes(value: unknown): KbVisibilityScope[] {
  if (!Array.isArray(value)) return DEFAULT_VISIBILITY;
  const scopes: KbVisibilityScope[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { scope_type?: unknown; scope_id?: unknown };
    const scope: KbVisibilityScope | null =
      raw.scope_type === "all"
        ? { scope_type: "all", scope_id: null }
        : raw.scope_type === "org" || raw.scope_type === "dept" || raw.scope_type === "team"
          ? typeof raw.scope_id === "string" && raw.scope_id
            ? { scope_type: raw.scope_type, scope_id: raw.scope_id }
            : null
          : null;
    if (!scope) continue;
    const key = scopeKey(scope);
    if (!seen.has(key)) {
      seen.add(key);
      scopes.push(scope);
    }
  }
  return scopes.length > 0 ? scopes : DEFAULT_VISIBILITY;
}

function findVisibilityName(tree: VisibilityTenant[], scope: KbVisibilityScope) {
  if (scope.scope_type === "all") return "全部可见";
  if (!scope.scope_id) return "";
  for (const tenant of tree) {
    if (scope.scope_type === "org" && tenant.code === scope.scope_id) {
      return `${tenant.name || tenant.code}`;
    }
    for (const dept of tenant.departments) {
      if (scope.scope_type === "dept" && dept.id === scope.scope_id) return dept.name;
      const team = dept.teams.find((item) => item.id === scope.scope_id);
      if (scope.scope_type === "team" && team) return team.name;
    }
  }
  return scope.scope_id;
}

function summarizeVisibility(scopes: KbVisibilityScope[], tree: VisibilityTenant[]) {
  if (scopes.length === 1 && scopes[0]?.scope_type === "all") return "全部可见";
  const labels = scopes.map((scope) => {
    const prefix =
      scope.scope_type === "org" ? "组织" : scope.scope_type === "dept" ? "部门" : "小组";
    return `${prefix}：${findVisibilityName(tree, scope)}`;
  });
  if (labels.length <= 2) return labels.join("，");
  return `${labels.slice(0, 2).join("，")} 等 ${labels.length} 个范围`;
}

export function KnowledgeBaseWorkbench({ initialKbId }: KnowledgeBaseWorkbenchProps) {
  const [list, setList] = useState<KnowledgeBase[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialKbId ?? null);
  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [refAgents, setRefAgents] = useState<RefAgent[]>([]);
  const [refCount, setRefCount] = useState(0);
  const [hasRefNames, setHasRefNames] = useState(true);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyDoc, setBusyDoc] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVisibilityScopes, setNewVisibilityScopes] = useState<KbVisibilityScope[]>(DEFAULT_VISIBILITY);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [visibilityScopes, setVisibilityScopes] = useState<KbVisibilityScope[]>(DEFAULT_VISIBILITY);
  const [editVisibilityScopes, setEditVisibilityScopes] = useState<KbVisibilityScope[]>(DEFAULT_VISIBILITY);
  const [visibilityTree, setVisibilityTree] = useState<VisibilityTenant[]>([]);
  const [canUseAllVisibility, setCanUseAllVisibility] = useState(false);
  const [visibilityOptionsLoading, setVisibilityOptionsLoading] = useState(false);
  const [docPage, setDocPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [returnDraftId, setReturnDraftId] = useState<string | null>(null);

  const detailRequestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const adminPerms = useAdminPermissions();

  const me: AdminMe | null = adminPerms.role
    ? { role: adminPerms.role, tenantCode: adminPerms.tenantCode }
    : null;

  const canCreateKb = adminPerms.canAction("kb", "create");

  const canUpdateKb = useMemo(() => {
    if (!adminPerms.loaded || !kb) return false;
    if (!adminPerms.canActOnCreator("kb", kb.created_by_role)) return false;
    if (adminPerms.has("kb.update.all")) return true;
    return (
      adminPerms.has("kb.update.org") &&
      !!kb.tenant_code &&
      kb.tenant_code === adminPerms.tenantCode
    );
  }, [adminPerms, kb]);

  const canDeleteKb = useMemo(() => {
    if (!adminPerms.loaded || !kb) return false;
    if (!adminPerms.canActOnCreator("kb", kb.created_by_role)) return false;
    if (adminPerms.has("kb.delete.all")) return true;
    return (
      adminPerms.has("kb.delete.org") &&
      !!kb.tenant_code &&
      kb.tenant_code === adminPerms.tenantCode
    );
  }, [adminPerms, kb]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.tenant_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [list, search]);

  const totalPages = Math.max(1, Math.ceil(docs.length / pageSize));
  const pageDocs = useMemo(() => {
    const safePage = Math.min(docPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return docs.slice(start, start + pageSize);
  }, [docPage, docs, pageSize, totalPages]);

  const visibilitySummary = useMemo(
    () => summarizeVisibility(visibilityScopes, visibilityTree),
    [visibilityScopes, visibilityTree],
  );
  const editScopeKeys = useMemo(
    () => new Set(editVisibilityScopes.map(scopeKey)),
    [editVisibilityScopes],
  );
  const newScopeKeys = useMemo(
    () => new Set(newVisibilityScopes.map(scopeKey)),
    [newVisibilityScopes],
  );
  const newVisibilityMode =
    newVisibilityScopes.length === 1 && newVisibilityScopes[0]?.scope_type === "all"
      ? "all"
      : "custom";
  const editVisibilityMode =
    editVisibilityScopes.length === 1 && editVisibilityScopes[0]?.scope_type === "all"
      ? "all"
      : "custom";

  const selectKnowledgeBase = useCallback((id: string | null) => {
    setSelectedId(id);
    setDocPage(1);
    setMsg("");
    setErr("");
    syncKnowledgeBaseUrl(id);
  }, []);

  const loadList = useCallback(async (preferredId?: string | null) => {
    setListLoading(true);
    try {
      const res = await fetch("/api/admin/knowledge-bases", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "加载知识库列表失败");
      const items = (json.data ?? []) as KnowledgeBase[];
      setList(items);
      setSelectedId((prev) => {
        const target = preferredId ?? prev ?? initialKbId ?? items[0]?.id ?? null;
        if (target) return target;
        return items[0]?.id ?? null;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载知识库列表失败");
    } finally {
      setListLoading(false);
    }
  }, [initialKbId]);

  const loadDetail = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    const requestId = ++detailRequestRef.current;
    const silent = opts?.silent === true;
    if (!silent) {
      setDetailLoading(true);
      setErr("");
    }
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "加载知识库详情失败");
      if (requestId !== detailRequestRef.current) return;
      setKb(json.knowledgeBase);
      setDocs(json.documents ?? []);
      setVisibilityScopes(normalizeVisibilityScopes(json.visibilityScopes));
      if (Array.isArray(json.referencedByAgents)) {
        setRefAgents(json.referencedByAgents);
        setRefCount(json.referencedByAgents.length);
        setHasRefNames(true);
      } else {
        setRefAgents([]);
        setRefCount(Number(json.referencedByAgentCount ?? 0));
        setHasRefNames(false);
      }
    } catch (e) {
      if (!silent && requestId === detailRequestRef.current) {
        setKb(null);
        setDocs([]);
        setRefAgents([]);
        setRefCount(0);
        setVisibilityScopes(DEFAULT_VISIBILITY);
        setErr(e instanceof Error ? e.message : "加载知识库详情失败");
      }
    } finally {
      if (!silent && requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  const loadVisibilityOptions = useCallback(async () => {
    if (visibilityTree.length > 0) return;
    setVisibilityOptionsLoading(true);
    try {
      const res = await fetch("/api/admin/knowledge-bases/visibility-options", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "加载可见范围失败");
      setCanUseAllVisibility(Boolean(json.canUseAll));
      setVisibilityTree((json.tree ?? []) as VisibilityTenant[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载可见范围失败");
    } finally {
      setVisibilityOptionsLoading(false);
    }
  }, [visibilityTree.length]);

  function openCreateModal() {
    setShowCreate(true);
    setNewVisibilityScopes(DEFAULT_VISIBILITY);
    void loadVisibilityOptions();
  }

  function setNewVisibilityMode(mode: "all" | "custom") {
    if (mode === "all") {
      setNewVisibilityScopes(DEFAULT_VISIBILITY);
      return;
    }
    setNewVisibilityScopes((prev) =>
      prev.some((scope) => scope.scope_type !== "all")
        ? prev.filter((scope) => scope.scope_type !== "all")
        : [],
    );
  }

  function toggleNewVisibilityScope(scope: KbVisibilityScope) {
    setNewVisibilityScopes((prev) => {
      const withoutAll = prev.filter((item) => item.scope_type !== "all");
      const key = scopeKey(scope);
      if (withoutAll.some((item) => scopeKey(item) === key)) {
        return withoutAll.filter((item) => scopeKey(item) !== key);
      }
      return [...withoutAll, scope];
    });
  }

  function openEditModal() {
    if (!kb) return;
    setEditing(true);
    setEditName(kb.name);
    setEditDesc(kb.description);
    setEditVisibilityScopes(visibilityScopes);
    void loadVisibilityOptions();
  }

  function setEditVisibilityMode(mode: "all" | "custom") {
    if (mode === "all") {
      setEditVisibilityScopes(DEFAULT_VISIBILITY);
      return;
    }
    setEditVisibilityScopes((prev) =>
      prev.some((scope) => scope.scope_type !== "all")
        ? prev.filter((scope) => scope.scope_type !== "all")
        : [],
    );
  }

  function toggleEditVisibilityScope(scope: KbVisibilityScope) {
    setEditVisibilityScopes((prev) => {
      const withoutAll = prev.filter((item) => item.scope_type !== "all");
      const key = scopeKey(scope);
      if (withoutAll.some((item) => scopeKey(item) === key)) {
        return withoutAll.filter((item) => scopeKey(item) !== key);
      }
      return [...withoutAll, scope];
    });
  }

  useEffect(() => {
    void loadList(initialKbId ?? null);
  }, [initialKbId, loadList]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get("draftId");
    setReturnDraftId(params.get("from") === "agent-builder" && draftId ? draftId : null);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setKb(null);
      setDocs([]);
      setRefAgents([]);
      setRefCount(0);
      return;
    }
    setDocPage(1);
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const hasActive = docs.some((doc) => doc.status === "pending" || doc.status === "indexing");
    if (!selectedId || !hasActive) return;
    const timer = window.setInterval(() => {
      void loadDetail(selectedId, { silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [docs, loadDetail, selectedId]);

  useEffect(() => {
    if (docPage > totalPages) setDocPage(totalPages);
  }, [docPage, totalPages]);

  async function handleCreate() {
    if (!newName.trim()) {
      setErr("请填写知识库名称");
      return;
    }
    if (newVisibilityMode === "custom" && newVisibilityScopes.length === 0) {
      setErr("请选择至少一个可见组织、部门或小组");
      return;
    }
    setCreateBusy(true);
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          visibilityScopes: newVisibilityScopes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "创建知识库失败");
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setNewVisibilityScopes(DEFAULT_VISIBILITY);
      setMsg("知识库已创建");
      await loadList(json.id ?? null);
      if (json.id) {
        selectKnowledgeBase(json.id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建知识库失败");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!kb || !canUpdateKb) return;
    if (!editName.trim()) {
      setErr("知识库名称不能为空");
      return;
    }
    if (editVisibilityMode === "custom" && editVisibilityScopes.length === 0) {
      setErr("请选择至少一个可见组织、部门或小组");
      return;
    }
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          visibilityScopes: editVisibilityScopes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "保存失败");
      setEditing(false);
      setMsg("知识库信息已保存");
      await Promise.all([loadList(kb.id), loadDetail(kb.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus() {
    if (!kb || !canUpdateKb) return;
    const next = kb.status === "active" ? "disabled" : "active";
    if (next === "disabled") {
      const ok = window.confirm(
        `确认停用「${kb.name}」？\n\n停用后：\n- 已绑定的智能体对话时不再命中本库片段\n- 文档和绑定关系都会保留\n- 点击启用可恢复检索\n\n这不是删除，也不会解绑。`,
      );
      if (!ok) return;
    }
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "操作失败");
      setMsg(next === "active" ? "知识库已启用" : "知识库已停用");
      await Promise.all([loadList(kb.id), loadDetail(kb.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function handleDeleteKb() {
    if (!kb || !canDeleteKb) return;
    const ok = window.confirm(
      `确认删除知识库「${kb.name}」？\n\n文档与索引会一并删除；如果该知识库仍被智能体引用，后端会阻止删除。`,
    );
    if (!ok) return;
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "删除失败");
      const next = list.find((item) => item.id !== kb.id)?.id ?? null;
      setMsg("知识库已删除");
      selectKnowledgeBase(next);
      await loadList(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleUpload(file: File) {
    if (!kb || !canUpdateKb) return;
    setUploading(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}/documents`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "上传失败");
      const doc = json.document as KbDocument | null;
      setMsg(doc ? `「${doc.filename}」已上传，正在后台索引` : "文档已上传，正在后台索引");
      await Promise.all([loadDetail(kb.id), loadList(kb.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleReindex(doc: KbDocument) {
    if (!kb || !canUpdateKb) return;
    setBusyDoc(doc.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(
        `/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "重建失败");
      setMsg(`「${doc.filename}」已进入重建队列`);
      await loadDetail(kb.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "重建失败");
    } finally {
      setBusyDoc("");
    }
  }

  async function handleDeleteDoc(doc: KbDocument) {
    if (!kb || !canUpdateKb) return;
    if (!window.confirm(`确认删除文档「${doc.filename}」？`)) return;
    setBusyDoc(doc.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(
        `/api/admin/knowledge-bases/${encodeURIComponent(kb.id)}/documents/${encodeURIComponent(doc.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "删除文档失败");
      setMsg("文档已删除");
      await Promise.all([loadDetail(kb.id), loadList(kb.id)]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除文档失败");
    } finally {
      setBusyDoc("");
    }
  }

  function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleUpload(file);
  }

  return (
    <AdminLayout fullBleed hideFooter>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#f3f6ff] lg:min-h-screen">
        <div className="flex min-h-[calc(100vh-3.5rem)] gap-5 p-5 sm:p-7 lg:min-h-screen">
          <aside className="hidden w-[300px] shrink-0 flex-col overflow-hidden rounded-[16px] border border-gray-200 bg-white shadow-sm xl:flex">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-semibold text-gray-950">知识库</h1>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[12px] text-gray-400">
                  ?
                </span>
              </div>
              <div className="relative mt-5">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索知识库"
                  className="h-11 w-full rounded-[10px] border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                />
              </div>
              {canCreateKb && (
                <button
                  type="button"
                  onClick={() => {
                    openCreateModal();
                    setErr("");
                  }}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#002FA7] text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,47,167,0.24)] transition hover:bg-[#1a47c0]"
                >
                  <Plus size={16} />
                  新建知识库
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {listLoading ? (
                <div className="space-y-2 px-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-[76px] animate-pulse rounded-[12px] bg-gray-100" />
                  ))}
                </div>
              ) : filteredList.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-gray-400">
                  {search.trim() ? "没有匹配的知识库" : "还没有知识库"}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredList.map((item) => {
                    const active = item.id === selectedId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectKnowledgeBase(item.id)}
                        className={`flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition ${
                          active
                            ? "bg-[#eef4ff] shadow-[0_1px_8px_rgba(0,47,167,0.08)]"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
                            active ? "bg-[#002FA7] text-white" : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          <FileText size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-gray-900">
                              {item.name}
                            </span>
                            <OwnershipBadge kb={item} me={me} />
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {item.document_count ?? 0} 个文档
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-500">
              共 {list.length} 个知识库
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1320px]">
              <div className="mb-5 xl:hidden">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h1 className="text-[22px] font-semibold text-gray-950">知识库</h1>
                  {canCreateKb && (
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#002FA7] px-4 text-sm font-semibold text-white"
                    >
                      <Plus size={15} />
                      新建
                    </button>
                  )}
                </div>
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => selectKnowledgeBase(e.target.value || null)}
                  className="h-11 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none"
                >
                  {list.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              {err && (
                <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{err}</span>
                </div>
              )}
              {msg && (
                <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{msg}</span>
                </div>
              )}

              {!selectedId && !listLoading ? (
                <EmptyState canCreate={canCreateKb} onCreate={openCreateModal} />
              ) : detailLoading ? (
                <DetailSkeleton />
              ) : !kb ? (
                <div className="rounded-[16px] border border-gray-200 bg-white py-20 text-center text-sm text-gray-500">
                  请选择一个知识库，或确认当前账号是否有访问权限。
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="overflow-hidden rounded-[16px] border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-5 px-5 py-5 lg:flex-row lg:items-start lg:px-7">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] bg-[#002FA7] text-white shadow-[0_8px_24px_rgba(0,47,167,0.24)]">
                        <BookOpen size={30} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-[24px] font-semibold text-gray-950">
                            {kb.name}
                          </h2>
                          <OwnershipBadge kb={kb} me={me} tone="solid" />
                          {kb.status === "disabled" && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                              已停用
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          {kb.description || "（无描述）"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {returnDraftId && (
                          <a
                            href={`/admin/agent-builder/${encodeURIComponent(returnDraftId)}`}
                            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#002FA7]/20 bg-[#002FA7]/5 px-4 text-sm font-medium text-[#002FA7] shadow-sm transition hover:bg-[#002FA7]/10"
                          >
                            <ChevronLeft size={15} />
                            返回智能体搭建
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={openEditModal}
                          disabled={!canUpdateKb}
                          title={canUpdateKb ? "编辑" : READONLY_TITLE}
                          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition hover:border-[#002FA7]/30 hover:text-[#002FA7] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Edit3 size={15} />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={toggleStatus}
                          disabled={!canUpdateKb}
                          title={canUpdateKb ? undefined : READONLY_TITLE}
                          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition hover:border-amber-300 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Power size={15} />
                          {kb.status === "active" ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteKb}
                          disabled={!canDeleteKb}
                          title={canDeleteKb ? "删除" : READONLY_TITLE}
                          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-4 text-sm font-medium text-red-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-gray-100 bg-[#f8fbff] px-5 py-4 text-sm text-gray-600 lg:flex-row lg:items-center lg:justify-between lg:px-7">
                      <div className="flex min-w-0 items-center gap-2">
                        <Bot size={15} className="shrink-0 text-gray-400" />
                        <ReferenceText
                          count={refCount}
                          agents={refAgents}
                          hasNames={hasRefNames}
                        />
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <Globe2 size={15} className="shrink-0 text-gray-400" />
                        <span className="truncate">可见范围：{visibilitySummary}</span>
                      </div>
                    </div>
                  </section>

                  {kb.status === "disabled" && (
                    <div className="flex items-start gap-2 rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        该知识库已停用。停用只表示不参与检索，文档和智能体绑定关系都会保留。
                      </span>
                    </div>
                  )}

                  <section className="overflow-hidden rounded-[16px] border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-5 lg:flex-row lg:items-center lg:px-7">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#002FA7] text-white shadow-[0_8px_18px_rgba(0,47,167,0.18)]">
                        <FileText size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[18px] font-semibold text-gray-950">文档</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          共 {docs.length} 个文档 · {SUPPORTED_FILE_TEXT}
                        </p>
                      </div>
                      <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.pptx"
                        onChange={onFilePicked}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading || !canUpdateKb}
                        title={!canUpdateKb ? READONLY_TITLE : undefined}
                        className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-[#002FA7] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,47,167,0.24)] transition hover:bg-[#1a47c0] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                        {uploading ? "上传中" : "上传文档"}
                      </button>
                    </div>

                    {docs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] bg-gray-100">
                          <FileText size={24} className="text-gray-300" />
                        </div>
                        <p className="text-sm font-medium text-gray-500">还没有文档</p>
                        <p className="mt-1 text-xs text-gray-400">上传文档后会自动开始索引</p>
                      </div>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="min-w-[860px] w-full border-collapse text-sm">
                            <thead className="bg-[#fafbfc] text-left text-xs font-semibold text-gray-500">
                              <tr className="border-b border-gray-200">
                                <th className="px-6 py-4">文件名称</th>
                                <th className="w-28 px-4 py-4">分段数</th>
                                <th className="w-28 px-4 py-4">字数</th>
                                <th className="w-28 px-4 py-4">处理状态</th>
                                <th className="w-40 px-4 py-4 text-right">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {pageDocs.map((doc) => (
                                <tr key={doc.id} className="transition-colors hover:bg-gray-50/60">
                                  <td className="px-6 py-4">
                                    <div className="flex min-w-0 items-center gap-3">
                                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-gray-500">
                                        <FileText size={18} />
                                      </span>
                                      <div className="min-w-0">
                                        <p className="truncate font-medium text-gray-900">
                                          {doc.filename}
                                        </p>
                                        <p className="mt-1 text-xs text-gray-400">
                                          上传时间：{formatDate(doc.created_at)}
                                          {doc.status === "failed" && doc.error_msg ? ` · ${doc.error_msg}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-4 text-gray-700">
                                    {doc.status === "done" || doc.status === "indexing"
                                      ? doc.chunk_count.toLocaleString("zh-CN")
                                      : "-"}
                                  </td>
                                  <td className="px-4 py-4 text-gray-700">
                                    {doc.char_count > 0 ? doc.char_count.toLocaleString("zh-CN") : "-"}
                                  </td>
                                  <td className="px-4 py-4">
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_META[doc.status].className}`}>
                                      {STATUS_META[doc.status].label}
                                    </span>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="flex justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleReindex(doc)}
                                        disabled={
                                          !canUpdateKb ||
                                          busyDoc === doc.id ||
                                          doc.status === "pending" ||
                                          doc.status === "indexing"
                                        }
                                        title={canUpdateKb ? "重建索引" : READONLY_TITLE}
                                        className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs text-gray-600 transition hover:bg-gray-100 hover:text-[#002FA7] disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <RotateCcw size={13} />
                                        重建
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteDoc(doc)}
                                        disabled={!canUpdateKb || busyDoc === doc.id}
                                        title={canUpdateKb ? "删除文档" : READONLY_TITLE}
                                        className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                      >
                                        <Trash2 size={13} />
                                        删除
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="flex items-center justify-end border-t border-gray-100 bg-white px-6 py-4 text-sm text-gray-500">
                          <div className="flex flex-wrap items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                              disabled={docPage <= 1}
                              className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] px-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="上一页"
                              title="上一页"
                            >
                              <ChevronLeft size={16} />
                            </button>
                            <span className="min-w-16 text-center">
                              {Math.min(docPage, totalPages)} / {totalPages}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDocPage((p) => Math.min(totalPages, p + 1))}
                              disabled={docPage >= totalPages}
                              className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] px-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                              aria-label="下一页"
                              title="下一页"
                            >
                              <ChevronRight size={16} />
                            </button>
                            <select
                              value={pageSize}
                              onChange={(e) => {
                                setPageSize(Number(e.target.value));
                                setDocPage(1);
                              }}
                              className="h-8 rounded-[8px] border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none focus:border-[#002FA7]"
                            >
                              {PAGE_SIZES.map((size) => (
                                <option key={size} value={size}>
                                  {size} 条/页
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {showCreate && (
        <Modal title="新建知识库" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <Field label="名称">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-gray-200 px-3 text-sm outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                placeholder="如：产品手册库"
                autoFocus
              />
            </Field>
            <Field label="描述（可选）">
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-[10px] border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                placeholder="一句话说明这个知识库装的是什么资料"
              />
            </Field>
            <Field label="可见范围">
              <KbVisibilityScopeEditor
                mode={newVisibilityMode}
                scopes={newVisibilityScopes}
                scopeKeys={newScopeKeys}
                tree={visibilityTree}
                canUseAll={canUseAllVisibility}
                loading={visibilityOptionsLoading}
                onModeChange={setNewVisibilityMode}
                onToggleScope={toggleNewVisibilityScope}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-10 rounded-[10px] px-4 text-sm text-gray-600 transition hover:bg-gray-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={createBusy || !newName.trim()}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:bg-[#1a47c0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createBusy && <Loader2 size={15} className="animate-spin" />}
                创建
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && kb && (
        <Modal title="编辑知识库" onClose={() => setEditing(false)}>
          <div className="space-y-4">
            <Field label="名称">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-gray-200 px-3 text-sm outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                autoFocus
              />
            </Field>
            <Field label="描述（可选）">
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-[10px] border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              />
            </Field>
            <Field label="可见范围">
              <KbVisibilityScopeEditor
                mode={editVisibilityMode}
                scopes={editVisibilityScopes}
                scopeKeys={editScopeKeys}
                tree={visibilityTree}
                canUseAll={canUseAllVisibility}
                loading={visibilityOptionsLoading}
                onModeChange={setEditVisibilityMode}
                onToggleScope={toggleEditVisibilityScope}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-10 rounded-[10px] px-4 text-sm text-gray-600 transition hover:bg-gray-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={!editName.trim()}
                className="h-10 rounded-[10px] bg-[#002FA7] px-5 text-sm font-semibold text-white transition hover:bg-[#1a47c0] disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AdminLayout>
  );
}

function OwnershipBadge({
  kb,
  me,
  tone = "soft",
}: {
  kb: { tenant_code: string | null };
  me: AdminMe | null;
  tone?: "soft" | "solid";
}) {
  const base = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (kb.tenant_code === null) {
    return (
      <span className={`${base} ${tone === "solid" ? "bg-[#edf3ff] text-[#002FA7]" : "bg-[#edf3ff] text-[#2c5cc5]"}`}>
        平台公共
      </span>
    );
  }
  if (me?.role === "org_admin" && me.tenantCode === kb.tenant_code) {
    return <span className={`${base} bg-emerald-50 text-emerald-700`}>本组织</span>;
  }
  return (
    <span className={`${base} max-w-[120px] truncate bg-amber-50 text-amber-700`} title={kb.tenant_code}>
      {kb.tenant_code}
    </span>
  );
}

function ReferenceText({
  count,
  agents,
  hasNames,
}: {
  count: number;
  agents: RefAgent[];
  hasNames: boolean;
}) {
  if (count === 0) return <span>暂未被任何智能体引用</span>;
  if (!hasNames) {
    return (
      <span>
        被 <span className="font-semibold text-[#002FA7]">{count}</span> 个智能体引用（含本组织外）
      </span>
    );
  }
  return (
    <span className="truncate">
      被 <span className="font-semibold text-[#002FA7]">{agents.length}</span> 个智能体引用：
      {agents.map((agent) => agent.name).join("、")}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function VisibilityScopeEditor({
  mode,
  scopes,
  scopeKeys,
  tree,
  canUseAll,
  loading,
  onModeChange,
  onToggleScope,
}: {
  mode: "all" | "custom";
  scopes: KbVisibilityScope[];
  scopeKeys: Set<string>;
  tree: VisibilityTenant[];
  canUseAll: boolean;
  loading: boolean;
  onModeChange: (mode: "all" | "custom") => void;
  onToggleScope: (scope: KbVisibilityScope) => void;
}) {
  const [scopeSearch, setScopeSearch] = useState("");
  const [expandedTenants, setExpandedTenants] = useState<Set<string>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const searchText = scopeSearch.trim().toLowerCase();
  const filteredTree = useMemo(() => {
    if (!searchText) return tree;

    const includes = (value: string | null | undefined) =>
      (value ?? "").toLowerCase().includes(searchText);

    return tree
      .map((tenant) => {
        const tenantMatched = includes(tenant.name) || includes(tenant.code);
        if (tenantMatched) return tenant;

        const departments = tenant.departments
          .map((dept) => {
            const deptMatched = includes(dept.name) || includes(dept.id);
            const teams = dept.teams.filter((team) => includes(team.name) || includes(team.id));
            if (deptMatched) return dept;
            if (teams.length > 0) return { ...dept, teams };
            return null;
          })
          .filter((dept): dept is VisibilityDept => dept !== null);

        return departments.length > 0 ? { ...tenant, departments } : null;
      })
      .filter((tenant): tenant is VisibilityTenant => tenant !== null);
  }, [searchText, tree]);
  const autoExpandedTenantIds = useMemo(
    () => new Set(searchText ? filteredTree.map((tenant) => tenant.code) : []),
    [filteredTree, searchText],
  );
  const autoExpandedDeptIds = useMemo(() => {
    const ids = new Set<string>();
    if (!searchText) return ids;
    for (const tenant of filteredTree) {
      for (const dept of tenant.departments) ids.add(dept.id);
    }
    return ids;
  }, [filteredTree, searchText]);
  const selectedExpanded = useMemo(() => {
    const tenants = new Set<string>();
    const depts = new Set<string>();
    for (const tenant of tree) {
      for (const dept of tenant.departments) {
        if (scopeKeys.has(scopeKey({ scope_type: "dept", scope_id: dept.id }))) {
          tenants.add(tenant.code);
        }
        for (const team of dept.teams) {
          if (scopeKeys.has(scopeKey({ scope_type: "team", scope_id: team.id }))) {
            tenants.add(tenant.code);
            depts.add(dept.id);
          }
        }
      }
    }
    return { tenants, depts };
  }, [scopeKeys, tree]);

  function toggleTenant(tenantCode: string) {
    setExpandedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(tenantCode)) next.delete(tenantCode);
      else next.add(tenantCode);
      return next;
    });
  }

  function toggleDept(deptId: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canUseAll}
          onClick={() => onModeChange("all")}
          className={`flex h-10 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
            mode === "all"
              ? "border-[#002FA7] bg-[#edf3ff] text-[#002FA7]"
              : "border-gray-200 bg-white text-gray-700 hover:border-[#002FA7]/30"
          }`}
        >
          <Globe2 size={15} />
          全部可见
        </button>
        <button
          type="button"
          onClick={() => onModeChange("custom")}
          className={`flex h-10 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition ${
            mode === "custom"
              ? "border-[#002FA7] bg-[#edf3ff] text-[#002FA7]"
              : "border-gray-200 bg-white text-gray-700 hover:border-[#002FA7]/30"
          }`}
        >
          <Building2 size={15} />
          指定范围
        </button>
      </div>
      {!canUseAll && (
        <p className="text-xs leading-5 text-gray-500">
          当前账号不能设置全平台可见，可在授权范围内选择组织、部门或小组。
        </p>
      )}
      {mode === "custom" && (
        <div className="space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={scopeSearch}
              onChange={(e) => setScopeSearch(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              placeholder="搜索组织 / 部门 / 小组"
            />
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50/60">
            {loading ? (
              <div className="flex h-24 items-center justify-center gap-2 text-sm text-gray-400">
                <Loader2 size={15} className="animate-spin" />
                加载可选范围…
              </div>
            ) : tree.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">
                当前没有可选组织范围
              </div>
            ) : filteredTree.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">
                没有匹配的范围
              </div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                {filteredTree.map((tenant) => {
                  const orgScope: KbVisibilityScope = { scope_type: "org", scope_id: tenant.code };
                  const tenantOpen = searchText
                    ? autoExpandedTenantIds.has(tenant.code)
                    : expandedTenants.has(tenant.code) || selectedExpanded.tenants.has(tenant.code);
                  return (
                    <div key={tenant.code} className="rounded-[10px] border border-gray-200 bg-white p-2">
                      <div className="flex items-center gap-1 rounded-[8px] border border-gray-200 bg-gray-50 pr-2">
                        <ExpandButton
                          open={tenantOpen}
                          disabled={tenant.departments.length === 0}
                          onClick={() => toggleTenant(tenant.code)}
                        />
                        <ScopeCheckbox
                          checked={scopeKeys.has(scopeKey(orgScope))}
                          label={`${tenant.name || tenant.code} (${tenant.code})`}
                          icon={<Building2 size={14} />}
                          onChange={() => onToggleScope(orgScope)}
                        />
                      </div>
                      {tenantOpen && tenant.departments.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-l border-gray-100 pl-5">
                          {tenant.departments.map((dept) => {
                            const deptScope: KbVisibilityScope = {
                              scope_type: "dept",
                              scope_id: dept.id,
                            };
                            const deptOpen = searchText
                              ? autoExpandedDeptIds.has(dept.id)
                              : expandedDepts.has(dept.id) || selectedExpanded.depts.has(dept.id);
                            return (
                              <div key={dept.id} className="space-y-1">
                                <div className="flex items-center gap-1 rounded-[8px] pr-2 hover:bg-gray-50">
                                  <ExpandButton
                                    open={deptOpen}
                                    disabled={dept.teams.length === 0}
                                    onClick={() => toggleDept(dept.id)}
                                    size="sm"
                                  />
                                  <ScopeCheckbox
                                    checked={scopeKeys.has(scopeKey(deptScope))}
                                    label={dept.name}
                                    icon={<Users size={14} />}
                                    onChange={() => onToggleScope(deptScope)}
                                  />
                                </div>
                                {deptOpen && dept.teams.length > 0 && (
                                  <div className="grid grid-cols-1 gap-1 pl-8 sm:grid-cols-2">
                                    {dept.teams.map((team) => {
                                      const teamScope: KbVisibilityScope = {
                                        scope_type: "team",
                                        scope_id: team.id,
                                      };
                                      return (
                                        <ScopeCheckbox
                                          key={team.id}
                                          checked={scopeKeys.has(scopeKey(teamScope))}
                                          label={team.name}
                                          dense
                                          onChange={() => onToggleScope(teamScope)}
                                        />
                                      );
                                    })}
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
            )}
          </div>
        </div>
      )}
      {mode === "custom" && scopes.length === 0 && (
        <p className="text-xs text-red-500">请至少选择一个可见组织、部门或小组。</p>
      )}
    </div>
  );
}

function ExpandButton({
  open,
  disabled,
  size = "md",
  onClick,
}: {
  open: boolean;
  disabled?: boolean;
  size?: "md" | "sm";
  onClick: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center rounded-[8px] text-gray-500 transition hover:bg-white/80 disabled:cursor-default disabled:opacity-25 ${
        size === "sm" ? "h-7 w-7" : "h-8 w-8"
      }`}
      title={open ? "收起" : "展开"}
    >
      <Icon size={15} />
    </button>
  );
}

function ScopeCheckbox({
  checked,
  label,
  icon,
  dense,
  onChange,
}: {
  checked: boolean;
  label: string;
  icon?: React.ReactNode;
  dense?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[8px] transition hover:bg-gray-100 ${
        dense ? "px-2 py-1 text-xs text-gray-600" : "px-2 py-1.5 text-sm text-gray-700"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-[#002FA7]"
      />
      {icon && <span className="shrink-0 text-gray-400">{icon}</span>}
      <span className="truncate">{label}</span>
    </label>
  );
}

function EmptyState({ canCreate, onCreate }: { canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-[16px] border border-gray-200 bg-white py-20 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] bg-gray-100">
        <BookOpen size={24} className="text-gray-300" />
      </div>
      <p className="text-sm font-medium text-gray-500">还没有知识库</p>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#002FA7] px-4 text-sm font-semibold text-white"
        >
          <Plus size={15} />
          新建知识库
        </button>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-44 animate-pulse rounded-[16px] border border-gray-200 bg-white" />
      <div className="h-[420px] animate-pulse rounded-[16px] border border-gray-200 bg-white" />
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[calc(100vh-4rem)] w-full max-w-[620px] overflow-y-auto rounded-[16px] bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-950">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
      {children}
    </div>
  );
}
