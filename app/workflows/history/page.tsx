"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, Search, Trash2, ChevronRight, Loader2, RotateCcw } from "lucide-react";

type StatusFilter = "all" | "completed" | "abandoned";

type SessionItem = {
  id: string;
  name: string;
  currentStepIdx: number;
  totalSteps: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  workflow: { id: string; name: string; description?: string } | null;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  completed: { text: "已完成", cls: "bg-emerald-50 text-emerald-600" },
  abandoned: { text: "已放弃", cls: "bg-gray-100 text-gray-500" },
  in_progress: { text: "进行中", cls: "bg-blue-50 text-blue-600" },
};

export default function WorkflowHistoryPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/workflow-sessions?status=history", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setSessions([]);
          return;
        }
        const data = await res.json();
        if (!cancelled) setSessions(Array.isArray(data) ? data : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (k) {
        const hay = `${s.name} ${s.workflow?.name ?? ""}`.toLowerCase();
        if (!hay.includes(k)) return false;
      }
      return true;
    });
  }, [sessions, keyword, statusFilter]);

  // 5.16up R3 · 恢复已放弃的工作流：状态改回 in_progress，保留 current_step_idx
  async function restoreSession(s: SessionItem) {
    setRestoringId(s.id);
    try {
      const res = await fetch(`/api/workflow-sessions/${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "恢复失败");
        return;
      }
      // 恢复成功：会话回到「进行中」，从历史列表移除
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      alert(`「${s.name}」已恢复，可回到首页「进行中」继续。`);
    } finally {
      setRestoringId(null);
    }
  }

  async function permanentlyDelete(s: SessionItem) {
    if (!confirm(`确认永久删除「${s.name}」？\n\n该会话及全部对话记录将不可恢复。`)) return;
    setDeletingId(s.id);
    try {
      const res = await fetch(`/api/workflow-sessions/${encodeURIComponent(s.id)}?hard=1`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "删除失败");
        return;
      }
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      <header className="bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 shadow-[0_4px_20px_rgba(0,47,167,0.12)]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <Link
              href="/"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center hover:bg-white/10 transition-colors"
              title="返回首页"
              aria-label="返回首页"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <History size={18} />
              <h1 className="text-[16px] font-semibold">历史工作流</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 sm:px-8 py-6">
        <div className="bg-white border border-gray-200 rounded-[16px] p-5 mb-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索会话名 / 工作流名"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {(["all", "completed", "abandoned"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-[13px] rounded-full border transition-colors ${
                    statusFilter === s
                      ? "bg-[#002FA7] text-white border-[#002FA7]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#002FA7]/40"
                  }`}
                >
                  {s === "all" ? "全部" : STATUS_LABEL[s]?.text}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-[16px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-gray-400">
              <Loader2 size={28} className="animate-spin text-[#002FA7]/60 mb-3" />
              <p className="text-sm">加载历史工作流中…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <History size={20} className="text-gray-300" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {sessions.length === 0 ? "暂无历史工作流" : "没有符合条件的记录"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {sessions.length === 0 ? "完成或放弃的会话会在这里出现" : "试试调整搜索词或筛选条件"}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((s) => {
                const label = STATUS_LABEL[s.status] ?? { text: s.status, cls: "bg-gray-100 text-gray-500" };
                return (
                  <li key={s.id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-semibold text-gray-900 truncate">{s.name}</p>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${label.cls}`}>
                          {label.text}
                        </span>
                      </div>
                      <p className="text-[12px] text-gray-400 mt-1 truncate">
                        {s.workflow?.name ?? "已删除的工作流"}
                        {" · "}
                        {s.status === "completed"
                          ? `完整 ${s.totalSteps} 步`
                          : `进度 ${s.currentStepIdx + 1}/${s.totalSteps} 步`}
                        {" · "}
                        {new Date(s.updatedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.status === "abandoned" && (
                        <button
                          onClick={() => restoreSession(s)}
                          disabled={restoringId === s.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 transition-colors"
                          title="恢复到「进行中」，继续这个工作流"
                        >
                          <RotateCcw size={12} /> {restoringId === s.id ? "恢复中…" : "恢复"}
                        </button>
                      )}
                      <Link
                        href={`/workflows/history/${encodeURIComponent(s.id)}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors"
                      >
                        查看 <ChevronRight size={12} />
                      </Link>
                      <button
                        onClick={() => permanentlyDelete(s)}
                        disabled={deletingId === s.id}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        title="永久删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
