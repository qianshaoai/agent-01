"use client";
import { useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, History, Bot, User as UserIcon, Eye, Wrench, ChevronRight } from "lucide-react";

type SessionDetail = {
  id: string;
  name: string;
  currentStepIdx: number;
  totalSteps: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  workflow: { id: string; name: string; description?: string } | null;
};

type WorkflowStep = {
  id: string;
  step_order: number;
  title: string;
  description: string;
  exec_type: "agent" | "manual" | "review" | "external";
  agents?: { id: string; agent_code: string; name: string } | null;
};

type ConversationLite = {
  id: string;
  title: string;
  agents?: { agent_code: string; name: string } | null;
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  completed: { text: "已完成", cls: "bg-emerald-50 text-emerald-600" },
  abandoned: { text: "已放弃", cls: "bg-gray-100 text-gray-500" },
  in_progress: { text: "进行中", cls: "bg-blue-50 text-blue-600" },
};

export default function HistorySessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [conversations, setConversations] = useState<ConversationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // 拉所有历史会话，从中找到当前 sessionId 这条
        // 没有专门的 GET /api/workflow-sessions/[id]，先复用列表接口
        const sessionsRes = await fetch(`/api/workflow-sessions?status=history`, { cache: "no-store" });
        if (!sessionsRes.ok) {
          if (!cancelled) setError("无法加载会话信息");
          return;
        }
        const sessionsData: SessionDetail[] = await sessionsRes.json();
        const cur = Array.isArray(sessionsData) ? sessionsData.find((s) => s.id === sessionId) : null;
        if (!cur) {
          if (!cancelled) setError("会话不存在或不在历史记录中");
          return;
        }
        if (cancelled) return;
        setSession(cur);

        // 拉工作流步骤
        // 注意：/api/workflows/[id]/steps 返回 { id, name, description, steps: [...] }
        if (cur.workflow?.id) {
          const stepsRes = await fetch(`/api/workflows/${encodeURIComponent(cur.workflow.id)}/steps`, { cache: "no-store" });
          if (stepsRes.ok) {
            const stepsData = await stepsRes.json();
            const list = Array.isArray(stepsData?.steps) ? stepsData.steps : [];
            if (!cancelled) setSteps(list);
          }
        }

        // 拉该 session 下所有对话
        const convsRes = await fetch(`/api/conversations?sessionId=${encodeURIComponent(sessionId)}&pageSize=200`, { cache: "no-store" });
        if (convsRes.ok) {
          const convsData = await convsRes.json();
          // paginatedResponse 形态：{ data, total, page, pageSize }
          const list = Array.isArray(convsData) ? convsData : convsData?.data ?? [];
          if (!cancelled) setConversations(list as ConversationLite[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [sessionId]);

  // 把对话按 agent_code 索引，便于步骤切换时查找该 agent 步骤的对话
  const convsByAgent = useMemo(() => {
    const map = new Map<string, ConversationLite>();
    for (const c of conversations) {
      const code = c.agents?.agent_code;
      if (code && !map.has(code)) {
        map.set(code, c); // 该 agent 在该 session 下应该只有一条对话
      }
    }
    return map;
  }, [conversations]);

  const label = session ? (STATUS_LABEL[session.status] ?? { text: session.status, cls: "bg-gray-100 text-gray-500" }) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      <header className="bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 shadow-[0_4px_20px_rgba(0,47,167,0.12)]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-16 flex items-center gap-3 text-white">
          <Link
            href="/workflows/history"
            className="w-9 h-9 rounded-[10px] flex items-center justify-center hover:bg-white/10 transition-colors"
            title="返回历史列表"
            aria-label="返回历史列表"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            <History size={18} />
            <h1 className="text-[16px] font-semibold truncate">{session?.name ?? "历史工作流"}</h1>
            {label && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${label.cls}`}>
                {label.text}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-5 sm:px-8 py-6">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">加载中…</div>
        ) : error ? (
          <div className="bg-white border border-gray-200 rounded-[16px] p-10 text-center">
            <p className="text-sm font-medium text-red-500">{error}</p>
            <Link href="/workflows/history" className="inline-block mt-3 text-[13px] text-[#002FA7] hover:underline">
              返回历史列表
            </Link>
          </div>
        ) : session ? (
          <>
            <div className="bg-white border border-gray-200 rounded-[16px] p-5 mb-5 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <p className="text-[13px] text-gray-500">
                工作流：<span className="text-gray-800 font-medium">{session.workflow?.name ?? "已删除"}</span>
              </p>
              <p className="text-[13px] text-gray-500 mt-1">
                {session.status === "completed"
                  ? `完整走完 ${session.totalSteps} 步`
                  : `进度 ${session.currentStepIdx + 1}/${session.totalSteps} 步`}
                {" · "}
                创建于 {new Date(session.createdAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
                {" · "}
                最后更新 {new Date(session.updatedAt).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-[16px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-[14px] font-semibold text-gray-900">步骤回看</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  点击智能体步骤进入只读对话回看；人工 / 审核 / 外部步骤无对话记录
                </p>
              </div>
              {steps.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">该工作流暂无步骤数据</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {steps.map((step, idx) => {
                    const conv = step.agents?.agent_code ? convsByAgent.get(step.agents.agent_code) : null;
                    const isAgent = step.exec_type === "agent";
                    const hasConv = !!conv;
                    return (
                      <li key={step.id} className="px-5 py-4 flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full border-2 border-white ring-1 ring-gray-200 flex items-center justify-center bg-[#002FA7]/10 shrink-0">
                          <span className="text-[12px] font-bold text-[#002FA7]">{idx + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[14px] font-semibold text-gray-900">{step.title}</span>
                            <StepBadge type={step.exec_type} />
                            {step.agents?.name && (
                              <span className="text-[11px] text-gray-400">@ {step.agents.name}</span>
                            )}
                          </div>
                          {step.description && (
                            <p className="text-[13px] text-gray-500 leading-relaxed mt-1">{step.description}</p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {!isAgent ? (
                            <span className="text-[12px] text-gray-400 px-3 py-1.5 rounded-[8px] bg-gray-50">
                              无对话
                            </span>
                          ) : !hasConv ? (
                            <span className="text-[12px] text-gray-400 px-3 py-1.5 rounded-[8px] bg-gray-50">
                              {session.status === "completed" ? "未对话" : "未进入此步"}
                            </span>
                          ) : (
                            <Link
                              href={`/agents/${encodeURIComponent(step.agents!.agent_code)}?session=${encodeURIComponent(sessionId)}&step=${idx}&readonly=1&conv=${encodeURIComponent(conv!.id)}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors"
                            >
                              回看对话 <ChevronRight size={12} />
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function StepBadge({ type }: { type: WorkflowStep["exec_type"] }) {
  const map: Record<WorkflowStep["exec_type"], { text: string; cls: string; Icon: typeof Bot }> = {
    agent: { text: "智能体", cls: "bg-blue-50 text-blue-600", Icon: Bot },
    manual: { text: "人工执行", cls: "bg-amber-50 text-amber-600", Icon: UserIcon },
    review: { text: "人工审核", cls: "bg-purple-50 text-purple-600", Icon: Eye },
    external: { text: "外部工具", cls: "bg-gray-50 text-gray-600", Icon: Wrench },
  };
  const it = map[type];
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1 ${it.cls}`}>
      <it.Icon size={11} />
      {it.text}
    </span>
  );
}
