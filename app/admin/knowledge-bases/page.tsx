"use client";

// 5.19up 知识库方案 A · PR-A3 · 知识库列表页

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  status: "active" | "disabled";
  document_count: number;
  created_at: string;
};

export default function KnowledgeBasesPage() {
  const [list, setList] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/knowledge-bases", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "加载失败");
      setList(json.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!newName.trim()) {
      setErr("请填写知识库名称");
      return;
    }
    setCreating(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "创建失败");
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(kb: KnowledgeBase) {
    if (!window.confirm(`确认删除知识库「${kb.name}」？文档与索引会一并删除。`)) return;
    setErr("");
    try {
      const res = await fetch(`/api/admin/knowledge-bases/${kb.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "删除失败");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">知识库</h1>
          <p className="text-sm text-gray-500 mt-1">
            给「智能体搭建器」搭的智能体配知识库；上传的文档会被切块、向量化后供对话检索。
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setErr("");
          }}
          className="shrink-0 px-4 py-2 rounded-lg bg-[#002FA7] text-white text-sm font-medium hover:bg-[#0a3bc0]"
        >
          + 新建知识库
        </button>
      </div>

      {err && (
        <div className="px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 py-10 text-center">加载中…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">还没有知识库，点右上角新建。</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((kb) => (
            <div
              key={kb.id}
              className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/admin/knowledge-bases/${kb.id}`}
                  className="font-medium text-gray-900 hover:text-[#002FA7] truncate"
                >
                  {kb.name}
                </Link>
                {kb.status === "disabled" && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">
                    已停用
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 line-clamp-2 min-h-[2rem]">
                {kb.description || "（无描述）"}
              </p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-gray-400">{kb.document_count} 个文档</span>
                <div className="flex gap-3">
                  <Link
                    href={`/admin/knowledge-bases/${kb.id}`}
                    className="text-xs text-[#002FA7] hover:underline"
                  >
                    管理
                  </Link>
                  <button
                    onClick={() => handleDelete(kb)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">新建知识库</h2>
            <div>
              <label className="text-xs text-gray-500">名称</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
                placeholder="如：产品手册库"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">描述（可选）</label>
              <textarea
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-3 py-1.5 rounded-lg text-sm bg-[#002FA7] text-white disabled:opacity-50"
              >
                {creating ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
