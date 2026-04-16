import Link from "next/link";
import { ExternalLink, Bot, ChevronRight } from "lucide-react";
import type { UserAgentItem } from "@/lib/types";

export function UserAgentCard({ agent }: { agent: UserAgentItem }) {
  const isExternal = agent.agent_type === "external";

  const cardClass =
    "group bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,47,167,0.12)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3 cursor-pointer border border-transparent hover:border-[#002FA7]/10";

  const cardContent = (
    <>
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center ${isExternal ? "bg-orange-50" : "bg-[#002FA7]/8"}`}>
          {isExternal
            ? <ExternalLink size={20} className="text-orange-500" />
            : <Bot size={20} className="text-[#002FA7]" />}
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium mt-1">我的</span>
      </div>
      <div className="flex-1">
        <h3 className={`font-semibold text-gray-900 mb-1 transition-colors ${isExternal ? "group-hover:text-orange-500" : "group-hover:text-[#002FA7]"}`}>{agent.name}</h3>
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{agent.description || (isExternal ? "点击跳转外部链接" : `${agent.platform} 智能体`)}</p>
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-gray-400">{isExternal ? "外链跳转" : agent.platform}</span>
        <div className={`flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity ${isExternal ? "text-orange-500" : "text-[#002FA7]"}`}>
          {isExternal ? <>外链跳转 <ExternalLink size={12} /></> : <>开始对话 <ChevronRight size={14} /></>}
        </div>
      </div>
    </>
  );

  if (isExternal) {
    if (!agent.external_url) return <div className={cardClass + " opacity-50 cursor-not-allowed"}>{cardContent}</div>;
    return <a href={agent.external_url} target="_blank" rel="noopener noreferrer" className={cardClass}>{cardContent}</a>;
  }

  return <Link href={`/user-agents/${agent.id}`} className={cardClass}>{cardContent}</Link>;
}
