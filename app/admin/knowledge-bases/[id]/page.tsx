"use client";

// 5.19up 知识库方案 A · PR-A3 · 知识库详情 / 文档管理 / 引用反查

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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
  pending: "待处理",
  indexing: "索引中",
  done: "已完成",
  failed: "失败",
};
const STATUS_CLASS: Record<KbDocStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  indexing: "bg-blue-50 text-blue-600",
  done: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
};

export default function KnowledgeBaseDetailPage() {
  const params = useParams();
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

  if (loading) {
    return <p className="text-sm text-gray-400 py-10 text-center">加载中…</p>;
  }
  if (!kb) {
    return (
      <div className="space-y-3">
        <Link href="/admin/knowledge-bases" className="text-sm text-[#002FA7] hover:underline">
          ← 返回知识库列表
        </Link>
        <p className="text-sm text-red-600">{err || "知识库不存在"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/knowledge-bases" className="text-sm text-[#002FA7] hover:underline">
        ← 返回知识库列表
      </Link>

      {err && (
        <div className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {err}
        </div>
      )}
      {msg && (
        <div className="px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
            />
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1.5 rounded-lg text-sm bg-[#002FA7] text-white"
              >
                保存
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-gray-900 truncate">{kb.name}</h1>
                {kb.status === "disabled" && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                    已停用
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">{kb.description || "（无描述）"}</p>
            </div>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => {
                  setEditing(true);
                  setEditName(kb.name);
                  setEditDesc(kb.description);
                }}
                className="text-sm text-[#002FA7] hover:underline"
              >
                编辑
              </button>
              <button onClick={toggleStatus} className="text-sm text-gray-600 hover:underline">
                {kb.status === "active" ? "停用" : "启用"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500">
        {refAgents.length === 0 ? (
          "暂未被任何智能体引用"
        ) : (
          <>
            被 {refAgents.length} 个智能体引用：{refAgents.map((a) => a.name).join("、")}
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="font-medium text-gray-900">文档（{docs.length}）</h2>
          <div>
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
              className="px-3 py-1.5 rounded-lg text-sm bg-[#002FA7] text-white disabled:opacity-50"
            >
              {uploading ? "上传并索引中…" : "+ 上传文档"}
            </button>
          </div>
        </div>

        {docs.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            还没有文档。支持 pdf / docx / txt / md / csv / xlsx / pptx，单文件 ≤ 20MB。
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {docs.map((doc) => (
              <li key={doc.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{doc.filename}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {doc.status === "done"
                      ? `${doc.chunk_count} 个片段 · ${doc.char_count} 字符`
                      : doc.status === "failed"
                        ? doc.error_msg || "摄取失败"
                        : "—"}
                  </p>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${STATUS_CLASS[doc.status]}`}
                >
                  {STATUS_LABEL[doc.status]}
                </span>
                <button
                  onClick={() => handleReindex(doc)}
                  disabled={busyDoc === doc.id || doc.status === "indexing"}
                  className="text-xs text-[#002FA7] hover:underline disabled:opacity-40 shrink-0"
                >
                  重建索引
                </button>
                <button
                  onClick={() => handleDeleteDoc(doc)}
                  disabled={busyDoc === doc.id}
                  className="text-xs text-red-500 hover:underline disabled:opacity-40 shrink-0"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
