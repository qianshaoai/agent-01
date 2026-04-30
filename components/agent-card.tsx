import Link from "next/link";
import { ExternalLink, MessageSquare, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentItem } from "@/lib/types";

export function AgentCard({ agent, fromWorkflow }: { agent: AgentItem; fromWorkflow?: string }) {
  const isExternal = agent.agent_type === "external";
  // 4.30up 导航流：1→2→3→2→1，进 chat 时带上 wf=<workflowId>，
  // 聊天页"返回"读 wf 跳回主页对应工作流详情，而非直接回全部视图
  const chatHref = fromWorkflow
    ? `/agents/${agent.agent_code}?wf=${encodeURIComponent(fromWorkflow)}`
    : `/agents/${agent.agent_code}`;

  const cardClass =
    "group bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-gray-100/60 hover:shadow-[0_10px_28px_rgba(0,47,167,0.12)] hover:-translate-y-0.5 hover:border-[#002FA7]/20 transition-all duration-200 flex flex-col gap-4 cursor-pointer";

  const cardContent = (
    <>
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-[12px] flex items-center justify-center ${isExternal ? "bg-orange-50" : "bg-[#002FA7]/8"}`}>
          {isExternal
            ? <ExternalLink size={22} className="text-orange-500" />
            : <MessageSquare size={24} className="text-[#002FA7]" />}
        </div>
        <span className="text-[11px] text-gray-400 font-mono mt-1.5">{agent.agent_code}</span>
      </div>
      <div className="flex-1 min-h-0">
        <h3 className={`text-[15px] font-semibold text-gray-900 mb-1.5 transition-colors ${isExternal ? "group-hover:text-orange-500" : "group-hover:text-[#002FA7]"}`}>{agent.name}</h3>
        <p className="text-[13px] text-gray-500 leading-relaxed line-clamp-2">{agent.description}</p>
      </div>
      <div className="flex items-center justify-between pt-1 gap-2">
        <div className="flex flex-wrap gap-1 min-w-0">
          {agent.categoriesAll && agent.categoriesAll.length > 0 ? (
            agent.categoriesAll.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                {/* 小图标（<20px），next/image 优化收益低 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.icon_url ? <img src={c.icon_url} alt="" className="w-3.5 h-3.5 rounded-[3px] object-contain" /> : null}
                {c.name}
              </span>
            ))
          ) : (
            <Badge variant="muted">{agent.categories?.name ?? "通用"}</Badge>
          )}
        </div>
        <div className={`flex items-center gap-1 text-[12px] font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${isExternal ? "text-orange-500" : "text-[#002FA7]"}`}>
          {isExternal ? <>外链跳转 <ExternalLink size={13} /></> : <>开始对话 <ChevronRight size={14} /></>}
        </div>
      </div>
    </>
  );

  if (isExternal) {
    if (!agent.external_url) {
      return <div className={cardClass + " opacity-50 cursor-not-allowed"}>{cardContent}</div>;
    }
    return (
      <a
        href={agent.external_url}
        target="_blank"
        rel="noopener noreferrer"
        className={cardClass}
      >
        {cardContent}
      </a>
    );
  }

  return (
    <Link href={chatHref} className={cardClass}>
      {cardContent}
    </Link>
  );
}
