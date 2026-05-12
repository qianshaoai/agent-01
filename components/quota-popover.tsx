"use client";

// 5.12up · 个人额度可视化 · 阶段一 popover
// 触发位置：顶栏额度胶囊（首页 + 智能体页都接入）
// 数据源：GET /api/me/usage（统计口径 action='chat' AND status='success'，自然月起点）

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, RefreshCw, Loader2 } from "lucide-react";

type Usage = {
  isPersonal: boolean;
  quota: {
    orgUsed: number;
    orgTotal: number;
    myTotal: number;
    expiresAt: string | null;
  };
  counts: { today: number; thisWeek: number; thisMonth: number };
  topAgents: Array<{ agentCode: string; agentName: string; count: number }>;
};

export function QuotaPopover({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/me/usage", { cache: "no-store" });
      if (!res.ok) {
        setError(true);
        return;
      }
      const d: Usage = await res.json();
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // 打开时拉数据
  useEffect(() => {
    if (open) load();
  }, [open]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Esc 关闭 + 焦点回到面板
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // 仅组织用户判断"耗尽"档（个人用户没有 tenant 池）
  const orgPct =
    data && !data.isPersonal && data.quota.orgTotal > 0
      ? Math.round((data.quota.orgUsed / data.quota.orgTotal) * 100)
      : 0;
  const exhausted = !!data && !data.isPersonal && orgPct >= 100;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="appearance-none p-0 m-0 bg-transparent border-0 cursor-pointer"
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="我的用量"
          tabIndex={-1}
          className="absolute right-0 top-full mt-2 z-50 w-72 bg-white rounded-[14px] shadow-xl border border-gray-200 overflow-hidden focus:outline-none"
        >
          {exhausted && (
            <div className="bg-red-50 text-red-600 text-[12px] font-medium px-4 py-2 flex items-center gap-1.5 border-b border-red-100">
              <AlertTriangle size={13} /> 配额已用尽，请联系管理员
            </div>
          )}
          <div className="p-4">
            {loading ? (
              <SkeletonView />
            ) : error ? (
              <ErrorView onRetry={load} />
            ) : data ? (
              <ContentView data={data} orgPct={orgPct} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonView() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-gray-400">
      <Loader2 size={22} className="animate-spin text-[#002FA7]/60" />
      <p className="text-[12px]">加载用量中…</p>
    </div>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-center">
      <p className="text-sm text-gray-500">加载失败</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1 text-xs text-[#002FA7] hover:underline"
      >
        <RefreshCw size={11} /> 重试
      </button>
    </div>
  );
}

function ContentView({ data, orgPct }: { data: Usage; orgPct: number }) {
  const showOrgQuota = !data.isPersonal && data.quota.orgTotal > 0;
  // 公司额度进度条颜色档位
  const orgBarCls =
    orgPct >= 100
      ? "bg-red-500"
      : orgPct >= 80
      ? "bg-amber-500"
      : "bg-[#002FA7]";

  // "我累计消耗"
  const myTotal = data.quota.myTotal;
  const orgTotal = data.quota.orgTotal;
  const myOver = showOrgQuota && myTotal > orgTotal;
  const myPct = showOrgQuota
    ? Math.min(orgTotal > 0 ? (myTotal / orgTotal) * 100 : 0, 100)
    : 0;
  const remaining = Math.max(orgTotal - data.quota.orgUsed, 0);
  const remainingCls = orgPct >= 80 && orgPct < 100 ? "text-red-500" : "text-gray-500";

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">我的用量</h3>

      {showOrgQuota && (
        <>
          {/* 公司额度 */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[12px] text-gray-500">公司额度</span>
              <span className="text-[12px] text-gray-700 font-medium">
                {data.quota.orgUsed} / {data.quota.orgTotal} 次
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full ${orgBarCls} transition-all`}
                style={{ width: `${Math.min(orgPct, 100)}%` }}
              />
            </div>
            <p className={`text-[11px] mt-1 ${remainingCls}`}>
              已用 {orgPct}%（剩余 {remaining} 次）
            </p>
          </div>

          {/* 我累计消耗 */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[12px] text-gray-500">我累计消耗</span>
              <span className="text-[12px] text-gray-700 font-medium">
                {myTotal} / {orgTotal} 次
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gray-400 transition-all"
                style={{ width: `${myPct}%` }}
              />
            </div>
            {myOver && (
              <p className="text-[11px] mt-1 text-gray-400">
                已含历史 {myTotal - orgTotal} 次（配额可能续过费/重置过）
              </p>
            )}
          </div>

          <div className="border-t border-gray-100" />
        </>
      )}

      {/* 三档时间统计 */}
      <div className="space-y-1.5">
        <CountRow label="今天" value={data.counts.today} />
        <CountRow label="本周" value={data.counts.thisWeek} />
        <CountRow label="本月" value={data.counts.thisMonth} />
      </div>

      <div className="border-t border-gray-100" />

      {/* Top agents */}
      <div>
        <p className="text-[12px] text-gray-500 mb-1.5">本月最常用</p>
        {data.topAgents.length === 0 ? (
          <p className="text-[12px] text-gray-400 py-1">本月暂无调用</p>
        ) : (
          <ul className="space-y-1">
            {data.topAgents.map((a) => (
              <li
                key={a.agentCode}
                className="flex items-center gap-1.5 text-[12px] text-gray-700"
              >
                <Bot size={11} className="text-gray-400 shrink-0" />
                <span className="flex-1 min-w-0 truncate" title={a.agentName}>
                  {a.agentName}
                </span>
                <span className="text-gray-500 font-medium shrink-0">
                  {a.count} 次
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showOrgQuota && data.quota.expiresAt && (
        <>
          <div className="border-t border-gray-100" />
          <p className="text-[11px] text-gray-400">
            配额至 {data.quota.expiresAt}
          </p>
        </>
      )}
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12px] text-gray-500">{label}</span>
      <span className="text-[13px] text-gray-800 font-medium">{value} 次</span>
    </div>
  );
}
