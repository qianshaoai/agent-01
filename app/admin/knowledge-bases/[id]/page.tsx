"use client";

// 5.19up 知识库方案 A · PR-A3 · 知识库详情（5/19 视觉重做：对齐主页布局）

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  FileText,
  Upload,
  RotateCcw,
  Trash2,
  Edit,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Bot,
} from "lucide-react";

type KbDocStatus = "pending" | "indexing" | "done" | "failed";

type KbDocument = {
  id: string;
  filename: string;
  file_type: string;
  status: KbDocStatus;
  chunk_count: number;
  char_count: number;
  error_msg: string;
  created_at: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  status: "active" | "disabled";
  created_at: string;
};

type RefAgent = { id: string; name: string };

const STATUS_LABEL: Record<KbDocStatus, string> = {
  pending: "待索引",
  indexing: "索引中",
  done: "已完成",
  failed: "失败",
};
const STATUS_CLASS: Record<KbDocStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  indexing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
};

export default function KnowledgeBaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const kbId = typeof params?.id === "string" ? params.id : "";

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [refAgents, setRefAgents] = useState<RefAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyDoc, setBusyDoc] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const load = useCallback(async () => {
    if (!kbId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "加载失败");
      setKb(json.knowledgeBase);
      setDocs(json.documents ?? []);
      setRefAgents(json.referencedByAgents ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUpload(file: File) {
    setUploading(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}/documents`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "上传失败");
      const doc = json.document as KbDocument | null;
      if (doc?.status === "failed") {
        setErr(`「${doc.filename}」摄取失败：${doc.error_msg}`);
      } else if (doc) {
        setMsg(`「${doc.filename}」已上传并索引（${doc.chunk_count} 个片段）`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleReindex(doc: KbDocument) {
    setBusyDoc(doc.id);
    setErr("");
    setMsg("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}/documents/${doc.id}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "重建失败");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "重建失败");
    } finally {
      setBusyDoc("");
    }
  }

  async function handleDeleteDoc(doc: KbDocument) {
    if (!window.confirm(`确认删除文档「${doc.filename}」？`)) return;
    setBusyDoc(doc.id);
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}/documents/${doc.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "删除失败");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyDoc("");
    }
  }

  async function handleDeleteKb() {
    if (!kb) return;
    if (!window.confirm(`确认删除知识库「${kb.name}」？文档与索引会一并删除（被智能体引用时会阻止）。`)) return;
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "删除失败");
      router.push("/admin/knowledge-bases");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function handleSaveEdit() {
    if (!editName.trim()) {
      setErr("名称不能为空");
      return;
    }
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "保存失败");
      setEditing(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function toggleStatus() {
    if (!kb) return;
    const next = kb.status === "active" ? "disabled" : "active";
    // 停用是 "暂不参与检索"，文档和绑定都保留 —— 做个确认避免被误解为删除 / 解绑
    if (next === "disabled") {
      const ok = window.confirm(
        `确认停用「${kb.name}」？\n\n停用后：\n· 已绑定的智能体对话时不再命中本库片段\n· 文档与智能体绑定关系都保留\n· 点「启用」可随时恢复检索\n\n这不是删除、也不会解绑。`,
      );
      if (!ok) return;
    }
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "操作失败");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    }
  }

  return (
    <div className="relative -m-5 sm:-m-7 overflow-hidden bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff] min-h-[calc(100vh-3.5rem)]">
      {/* 浅色环境光晕 */}
      <div className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-[#7a93ff]/25 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 -left-32 w-[420px] h-[420px] rounded-full bg-[#8da4ff]/25 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[360px] h-[360px] rounded-full bg-[#a4b8ff]/30 blur-[120px] pointer-events-none" />

      <div className="relative p-5 sm:p-7 max-w-[1400px] mx-auto space-y-5 page-enter">
        <Link
          href="/admin/knowledge-bases"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:text-[#002FA7] hover:border-[#002FA7]/40 hover:bg-[#002FA7]/5 transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        >
          <ChevronLeft size={16} /> 返回知识库列表
        </Link>

        {err && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-[12px] bg-red-50/95 border border-red-200 text-sm text-red-700 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <AlertCircle size={15} className="shrink-0" />
            <span>{err}</span>
          </div>
        )}
        {msg && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-[12px] bg-green-50/95 border border-green-200 text-sm text-green-700 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{msg}</span>
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] py-20 text-center text-sm text-gray-400">
            加载中…
          </div>
        ) : !kb ? (
          <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] py-20 text-center text-sm text-red-600">
            知识库不存在
          </div>
        ) : (
          <>
            {/* KB 信息面板（白卡 + 图标圆） */}
            <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
              {editing ? (
                <div className="p-7 space-y-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60"
                    placeholder="知识库名称"
                  />
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60"
                    placeholder="描述（可选）"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="px-4 py-2 rounded-[10px] text-sm font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3.5 px-7 py-5">
                  <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-[#002FA7] to-[#1a47c0] flex items-center justify-center shadow-[0_4px_12px_rgba(0,47,167,0.25)] shrink-0">
                    <BookOpen size={22} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-[18px] font-semibold text-gray-900 leading-tight truncate">
                        {kb.name}
                      </h1>
                      {kb.status === "disabled" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
                          已停用
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-gray-500 mt-1 leading-relaxed">
                      {kb.description || "（无描述）"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditing(true);
                        setEditName(kb.name);
                        setEditDesc(kb.description);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#002FA7] px-3 py-1.5 rounded-[8px] hover:bg-gray-100 transition-colors"
                    >
                      <Edit size={12} /> 编辑
                    </button>
                    <button
                      onClick={toggleStatus}
                      className="text-xs text-gray-600 hover:text-amber-600 px-3 py-1.5 rounded-[8px] hover:bg-gray-100 transition-colors"
                      title={
                        kb.status === "active"
                          ? "停用检索：智能体不再命中本库，但文档与绑定关系保留（≠ 删除）"
                          : "启用检索：恢复智能体可命中本库片段"
                      }
                    >
                      {kb.status === "active" ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={handleDeleteKb}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-3 py-1.5 rounded-[8px] hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 停用语义说明 —— 仅 disabled 时显示 */}
            {kb.status === "disabled" && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-[12px] bg-amber-50/95 border border-amber-200 text-sm text-amber-800 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <p className="font-medium">该知识库已停用 —— 已绑定的智能体对话时不会再命中本库片段。</p>
                  <p className="text-amber-700/85 text-xs mt-1">
                    文档和与智能体的绑定关系都保留；点上方「启用」即可恢复检索。
                    <span className="font-medium">停用 ≠ 删除 / 解绑。</span>
                  </p>
                </div>
              </div>
            )}

            {/* 引用反查 */}
            <div className="flex items-center gap-2 px-1 text-[13px] text-gray-500">
              <Bot size={14} className="text-gray-400" />
              {refAgents.length === 0 ? (
                <span>暂未被任何智能体引用</span>
              ) : (
                <span>
                  被 <span className="text-[#002FA7] font-medium">{refAgents.length}</span> 个智能体引用：
                  {refAgents.map((a) => a.name).join("、")}
                </span>
              )}
            </div>

            {/* 文档面板 */}
            <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center gap-3.5 px-7 py-5 border-b border-gray-50">
                <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-[#002FA7] to-[#1a47c0] flex items-center justify-center shadow-[0_4px_12px_rgba(0,47,167,0.25)] shrink-0">
                  <FileText size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[18px] font-semibold text-gray-900 leading-tight">文档</p>
                  <p className="text-[13px] text-gray-500 mt-1">
                    共 {docs.length} 个 · 支持 pdf / docx / txt / md / csv / xlsx / pptx，单文件 ≤ 20MB
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls,.pptx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#002FA7] hover:bg-[#1a47c0] text-white text-sm font-semibold transition-colors shadow-[0_4px_12px_rgba(0,47,167,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={15} />
                  {uploading ? "上传并索引中…" : "上传文档"}
                </button>
              </div>

              {docs.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-14 h-14 rounded-[16px] bg-gray-100 flex items-center justify-center mb-4">
                    <FileText size={24} className="text-gray-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-500">还没有文档</p>
                  <p className="text-xs text-gray-400 mt-1">点右上角「上传文档」开始</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {docs.map((doc) => (
                    <li
                      key={doc.id}
                      className="px-7 py-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-[10px] bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText size={18} className="text-gray-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.filename}</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {doc.status === "done"
                            ? `${doc.chunk_count} 个片段 · ${doc.char_count.toLocaleString()} 字符`
                            : doc.status === "failed"
                              ? doc.error_msg || "摄取失败"
                              : doc.status === "indexing"
                                ? "正在索引…"
                                : "等待索引"}
                        </p>
                      </div>
                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full shrink-0 font-medium ${STATUS_CLASS[doc.status]}`}
                      >
                        {STATUS_LABEL[doc.status]}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleReindex(doc)}
                          disabled={busyDoc === doc.id || doc.status === "indexing"}
                          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#002FA7] px-2.5 py-1.5 rounded-[8px] hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                          title="重建索引"
                        >
                          <RotateCcw size={12} />
                          重建
                        </button>
                        <button
                          onClick={() => handleDeleteDoc(doc)}
                          disabled={busyDoc === doc.id}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2.5 py-1.5 rounded-[8px] hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                          title="删除文档"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
