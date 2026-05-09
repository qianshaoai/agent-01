import Link from "next/link";
import { ExternalLink, ArrowRight, Bot } from "lucide-react";
import type { WorkflowStep } from "@/lib/types";

export function WorkflowStepButton({
  step,
  fromWorkflow,
  stepIndex,
  isCompleted,
  sessionId,
}: {
  step: WorkflowStep;
  fromWorkflow?: string;
  stepIndex?: number;
  isCompleted?: boolean;
  sessionId?: string | null;
}) {
  const agent = step.agents;

  if (!step.agent_id) {
    return <span className="text-xs text-gray-400 italic shrink-0">未绑定智能体</span>;
  }

  if (!agent) {
    return <span className="text-xs text-red-400 bg-red-50 px-2.5 py-1 rounded-[8px] shrink-0">智能体已删除，请联系管理员</span>;
  }

  const isExternal = agent.agent_type === "external";

  if (isExternal && !agent.external_url) {
    return <span className="text-xs text-gray-400 italic shrink-0">外链地址未配置</span>;
  }

  if (isExternal) {
    return (
      <a
        href={agent.external_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-orange-50 text-orange-600 hover:bg-orange-100 shrink-0"
      >
        <ExternalLink size={11} />
        {step.button_text}
        <ArrowRight size={11} />
      </a>
    );
  }

  // 5.9up：当存在进行中会话时，所有步骤按钮都带上 sessionId，保持隔离
  const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";

  // 已完成步骤：绿色 ✓，跳转时携带 outline=1 让智能体自动生成大纲
  if (isCompleted) {
    const href = fromWorkflow
      ? `/agents/${agent.agent_code}?wf=${encodeURIComponent(fromWorkflow)}&step=${stepIndex ?? 0}&outline=1${sessionParam}`
      : `/agents/${agent.agent_code}?outline=1`;
    return (
      <Link href={href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 shrink-0">
        <span className="w-4 h-4 rounded-full bg-green-200 flex items-center justify-center text-green-700 text-[10px] font-bold shrink-0">✓</span>
        {step.button_text}
      </Link>
    );
  }

  // 当前/待解锁步骤：蓝色箭头
  const href = fromWorkflow
    ? `/agents/${agent.agent_code}?wf=${encodeURIComponent(fromWorkflow)}&step=${stepIndex ?? 0}${sessionParam}`
    : `/agents/${agent.agent_code}`;
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-[#002FA7]/8 text-[#002FA7] hover:bg-[#002FA7]/15 shrink-0">
      <Bot size={11} />
      {step.button_text}
      <ArrowRight size={11} />
    </Link>
  );
}
