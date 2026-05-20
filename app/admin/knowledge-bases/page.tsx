"use client";

// 5.19up 知识库方案 A · PR-A3 · 知识库列表页（5/19 视觉重做：对齐主页布局）

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BookOpen,
  Plus,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";

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

  return (
    <div className="relative -m-5 sm:-m-7 overflow-hidden bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff] min-h-[calc(100vh-3.5rem)]">
      {/* 浅色环境光晕（与主页一致） */}
      <div className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full bg-[#7a93ff]/25 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 -left-32 w-[420px] h-[420px] rounded-full bg-[#8da4ff]/25 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[360px] h-[360px] rounded-full bg-[#a4b8ff]/30 blur-[120px] pointer-events-none" />

      <div className="relative p-5 sm:p-7 max-w-[1400px] mx-auto space-y-6 page-enter">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:text-[#002FA7] hover:border-[#002FA7]/40 hover:bg-[#002FA7]/5 transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        >
          <ChevronLeft size={16} /> 返回管理后台首页
        </Link>

        {/* 顶部 section header + 新建按钮 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-[#002FA7]/10 flex items-center justify-center shrink-0">
                <BookOpen size={11} className="text-[#002FA7]" />
              </span>
              <h2 className="text-[15px] font-semibold text-gray-900">知识库</h2>
              <span className="text-[12px] text-gray-400">({list.length})</span>
            </div>
            <p className="text-[13px] text-gray-500 leading-relaxed max-w-2xl">
              给「智能体搭建器」搭的智能体配知识库；上传的文档会被切块、向量化后供对话检索。
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreate(true);
              setErr("");
            }}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#002FA7] hover:bg-[#1a47c0] text-white text-sm font-semibold transition-colors shadow-[0_4px_12px_rgba(0,47,167,0.25)]"
          >
            <Plus size={16} /> 新建知识库
          </button>
        </div>

        {err && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-[12px] bg-red-50/95 border border-red-200 text-sm text-red-700 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            <AlertCircle size={15} className="shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="bg-white/80 border border-gray-200 rounded-[20px] p-6 h-44 animate-pulse shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
              >
                <div className="w-12 h-12 bg-gray-100 rounded-[14px] mb-3" />
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] py-20 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 rounded-[16px] bg-gray-100 flex items-center justify-center mb-4">
              <BookOpen size={24} className="text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">还没有知识库</p>
            <p className="text-xs text-gray-400 mt-1">点右上角「新建知识库」开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {list.map((kb) => (
              <Link
                key={kb.id}
                href={`/admin/knowledge-bases/${kb.id}`}
                className="group relative overflow-hidden bg-gradient-to-br from-[#001f7a] via-[#002FA7] to-[#3b5fff] rounded-[20px] p-6 transition-all duration-500 flex flex-col gap-4 cursor-pointer text-left hover:-translate-y-1 shadow-[0_4px_16px_rgba(0,47,167,0.2)] hover:shadow-[0_24px_60px_rgba(59,95,255,0.45)]"
              >
                {/* 多层光晕 + 高光（与主页工作流卡同款） */}
                <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-[#6b87ff]/40 blur-[60px] pointer-events-none transition-all duration-500 group-hover:bg-[#a4b8ff]/55 group-hover:scale-110" />
                <div className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#3b5fff]/35 blur-[70px] pointer-events-none transition-all duration-500 group-hover:bg-[#6b87ff]/45" />
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

                <div className="relative flex items-start justify-between gap-2">
                  <div className="w-12 h-12 rounded-[14px] flex items-center justify-center bg-white/15 border border-white/20 backdrop-blur shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                    <BookOpen size={22} className="text-white" />
                  </div>
                  {kb.status === "disabled" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 text-white/85 border border-white/20 shrink-0">
                      已停用
                    </span>
                  )}
                </div>

                <div className="relative flex-1 min-h-0">
                  <h3 className="text-[16px] font-semibold text-white mb-2 leading-snug truncate">
                    {kb.name}
                  </h3>
                  <p className="text-[13px] text-white/75 leading-relaxed line-clamp-2">
                    {kb.description || "（无描述）"}
                  </p>
                </div>

                <div className="relative flex items-center justify-between pt-2 border-t border-white/15">
                  <span className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-full bg-white/15 text-white border border-white/20">
                    {kb.document_count} 个文档
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[12px] text-white/80 group-hover:text-white transition-colors">
                    管理 <ChevronRight size={12} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowCreate(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl w-[420px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 text-lg mb-5">新建知识库</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">名称</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border border-gray-200 rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60 mb-4"
              placeholder="如：产品手册库"
            />
            <label className="block text-sm font-medium text-gray-700 mb-1.5">描述（可选）</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60 mb-6 resize-none"
              placeholder="一句话说清这个知识库装的是什么资料"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="px-6 py-2 rounded-[10px] text-sm font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
