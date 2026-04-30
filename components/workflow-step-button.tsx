import Link from "next/link";
import { ExternalLink, ArrowRight, Bot } from "lucide-react";
import type { WorkflowStep } from "@/lib/types";

export function WorkflowStepButton({ step, fromWorkflow }: { step: WorkflowStep; fromWorkflow?: string }) {
  const agent = step.agents;

  // 未绑定智能体
  if (!step.agent_id) {
    return <span className="text-xs text-gray-400 italic shrink-0">未绑定智能体</span>;
  }

  // 智能体已被删除
  if (!agent) {
    return <span className="text-xs text-red-400 bg-red-50 px-2.5 py-1 rounded-[8px] shrink-0">智能体已删除，请联系管理员</span>;
  }

  const isExternal = agent.agent_type === "external";

  // 外链型但 URL 为空
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

  // 4.30up 导航流：进 chat 时带上 wf=<workflowId>，聊天页返回时回到对应工作流详情
  const href = fromWorkflow
    ? `/agents/${agent.agent_code}?wf=${encodeURIComponent(fromWorkflow)}`
    : `/agents/${agent.agent_code}`;
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-[#002FA7]/8 text-[#002FA7] hover:bg-[#002FA7]/15 shrink-0">
      <Bot size={11} />
      {step.button_text}
      <ArrowRight size={11} />
    </Link>
  );
}
