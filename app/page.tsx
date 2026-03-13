"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  mockCategories,
  mockAgents,
  mockNotices,
} from "@/lib/mock-data";
import {
  LogOut,
  Settings,
  MessageSquare,
  QrCode,
  ChevronRight,
  ChevronDown,
  Megaphone,
  Zap,
  Menu,
  X,
  ExternalLink,
  GitBranch,
  Bot,
  User,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type UserInfo = {
  phone: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
  quota: { total: number; used: number; left: number; expiresAt: string } | null;
};

type AgentItem = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
  agent_type?: string;
  external_url?: string;
  categories?: { name: string };
};

type CategoryItem = { id: string; name: string };
type NoticeItem = { id: string; tenant_code: string | null; content: string; enabled: boolean };

type WorkflowStep = {
  id: string;
  step_order: number;
  title: string;
  description: string;
  exec_type: "agent" | "manual";
  agent_id: string | null;
  button_text: string;
  enabled: boolean;
  agents?: { id: string; agent_code: string; name: string; agent_type: string; external_url: string } | null;
};

type WorkflowItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  workflow_steps: WorkflowStep[];
};

const LS_DISMISSED_KEY = "dismissed_notices_v1";

function getDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  try {
    localStorage.setItem(LS_DISMISSED_KEY, JSON.stringify([...set]));
  } catch {}
}

export default function HomePage() {
  const [activeCategory, setActiveCategory] = useState("__all__");
  const [contactOpen, setContactOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [workflowCollapsed, setWorkflowCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("wf_collapsed") === "1"; } catch { return false; }
  });
  const [agentCollapsed, setAgentCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("agent_collapsed") === "1"; } catch { return false; }
  });
  // 初始值直接从 localStorage 读取，避免通知先显示再消失的闪烁
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return getDismissed();
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [meRes, agentsRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/agents"),
        ]);

        if (!meRes.ok) {
          // Not logged in → fallback to mock
          setUser({
            phone: "138****8888",
            tenantCode: "DEMO2024",
            tenantName: "前哨科技示例企业",
            isPersonal: false,
            quota: { total: 500, used: 127, left: 373, expiresAt: "2025-12-31" },
          });
          setAgents(mockAgents.map((a) => ({
            id: a.id,
            agent_code: a.id,
            name: a.name,
            description: a.description,
            platform: a.platform,
            agent_type: "chat",
            external_url: "",
            categories: { name: a.categoryName },
          })));
          setCategories(mockCategories.filter((c) => c.id !== "1").map((c) => ({ id: c.id, name: c.name })));
          setNotices(mockNotices.map((n) => ({
            id: n.id,
            tenant_code: n.type === "enterprise" ? "DEMO2024" : null,
            content: n.content,
            enabled: n.enabled,
          })));
          return;
        }

        const meData = await meRes.json();
        setUser(meData);

        const agentsData = await agentsRes.json();
        setAgents(agentsData.agents ?? []);
        setCategories(agentsData.categories ?? []);

        const [noticesData, workflowsData] = await Promise.all([
          fetch(`/api/notices?tenantCode=${meData.tenantCode}`).then((r) => r.json()).catch(() => []),
          fetch("/api/workflows").then((r) => r.json()).catch(() => []),
        ]);
        setNotices(noticesData);

        const wfs: WorkflowItem[] = Array.isArray(workflowsData) ? workflowsData : [];
        setWorkflows(wfs);
        setActiveWorkflowId(wfs.length > 0 ? wfs[0].id : null);
      } catch {
        // fallback to mock
        setAgents(mockAgents.map((a) => ({
          id: a.id,
          agent_code: a.id,
          name: a.name,
          description: a.description,
          platform: a.platform,
          agent_type: "chat",
          external_url: "",
          categories: { name: a.categoryName },
        })));
        setCategories(mockCategories.filter((c) => c.id !== "1").map((c) => ({ id: c.id, name: c.name })));
        setNotices(mockNotices.map((n) => ({
          id: n.id,
          tenant_code: null,
          content: n.content,
          enabled: n.enabled,
        })));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function dismissNotice(id: string) {
    const next = new Set(dismissedNotices);
    next.add(id);
    setDismissedNotices(next);
    saveDismissed(next);
  }

  const allCats = [{ id: "__all__", name: "全部" }, ...categories];
  const filtered =
    activeCategory === "__all__"
      ? agents
      : agents.filter((a) => {
          const cat = categories.find((c) => c.id === activeCategory);
          return cat && a.categories?.name === cat.name;
        });

  async function switchCategory(catId: string) {
    setActiveCategory(catId);
    setSidebarOpen(false);
    // 按分类重新拉工作流
    const url = catId === "__all__" ? "/api/workflows" : `/api/workflows?categoryId=${catId}`;
    const wfs: WorkflowItem[] = await fetch(url).then((r) => r.json()).catch(() => []);
    setWorkflows(Array.isArray(wfs) ? wfs : []);
    setActiveWorkflowId(wfs.length > 0 ? wfs[0].id : null);
  }

  const quota = user?.quota;

  const visibleNotices = notices.filter((n) => n.enabled && !dismissedNotices.has(n.id));
  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId) ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fc]">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-[10px] hover:bg-gray-100" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu size={20} className="text-gray-600" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-[10px] bg-[#002FA7] flex items-center justify-center">
                <span className="text-white text-xs font-bold">AI</span>
              </div>
              <span className="font-semibold text-gray-900 hidden sm:block">AI 智能体平台</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {user && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#f0f4ff] rounded-[10px]">
                <div className="w-2 h-2 rounded-full bg-[#002FA7]" />
                <span className="text-xs font-medium text-[#002FA7]">
                  {user.isPersonal ? "个人空间" : user.tenantName}
                </span>
                {!user.isPersonal && <span className="text-xs text-gray-400">{user.tenantCode}</span>}
              </div>
            )}

            {quota && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-[10px]">
                <Zap size={13} className="text-amber-500" />
                <span className="text-xs text-gray-600">剩余 {quota.left} 次</span>
                <span className="text-xs text-gray-400">· 至 {quota.expiresAt}</span>
              </div>
            )}

            <button onClick={() => setContactOpen(true)} className="p-2 rounded-[10px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors" title="联系我们">
              <QrCode size={18} />
            </button>
            <Link href="/settings" className="p-2 rounded-[10px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
              <Settings size={18} />
            </Link>
            <button onClick={handleLogout} className="p-2 rounded-[10px] hover:bg-red-50 text-gray-500 hover:text-red-500 transition-colors" title="退出登录">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex gap-6">
        {/* 分类侧边栏 */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-60 bg-white shadow-xl p-6 flex flex-col gap-4 transform transition-transform duration-200 lg:static lg:z-auto lg:w-48 lg:shadow-none lg:bg-transparent lg:p-0 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-between lg:hidden mb-2">
            <span className="font-semibold text-gray-900">分类</span>
            <button onClick={() => setSidebarOpen(false)}><X size={20} className="text-gray-500" /></button>
          </div>
          <div className="hidden lg:block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">分类</div>
          <nav className="flex flex-col gap-1">
            {allCats.map((cat) => (
              <button
                key={cat.id}
                onClick={() => switchCategory(cat.id)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-150 ${activeCategory === cat.id ? "bg-[#002FA7] text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                <span>{cat.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        <main className="flex-1 min-w-0 page-enter">
          {/* ── 通知栏 ─────────────────────────────────────────────── */}
          {visibleNotices.length > 0 && (
            <div className="mb-6 space-y-2">
              {visibleNotices.map((notice) => (
                <div key={notice.id} className={`relative flex items-start gap-3 p-4 pr-10 rounded-[12px] text-sm ${notice.tenant_code ? "bg-[#f0f4ff] border border-[#002FA7]/10" : "bg-amber-50 border border-amber-100"}`}>
                  <Megaphone size={16} className={`mt-0.5 shrink-0 ${notice.tenant_code ? "text-[#002FA7]" : "text-amber-500"}`} />
                  <p className="text-gray-700 leading-relaxed">{notice.content}</p>
                  <button
                    onClick={() => dismissNotice(notice.id)}
                    className="absolute top-3 right-3 p-0.5 rounded-[6px] text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-colors"
                    title="关闭"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── 工作流引导模块（有工作流数据、或正在按分类过滤时才显示） */}
          {!loading && (workflows.length > 0 || activeCategory !== "__all__") && (
            <div className="mb-6 bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
              {/* 标题栏（始终显示，含折叠按钮） */}
              <button
                type="button"
                onClick={() => {
                  const next = !workflowCollapsed;
                  setWorkflowCollapsed(next);
                  try { localStorage.setItem("wf_collapsed", next ? "1" : "0"); } catch {}
                }}
                className="w-full flex items-center gap-2 px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors text-left"
              >
                <GitBranch size={15} className="text-[#002FA7] shrink-0" />
                <span className="text-sm font-semibold text-gray-800">工作流引导</span>
                <span className="text-xs text-gray-400 ml-1 flex-1">按流程操作，事半功倍</span>
                <ChevronDown size={15} className={`text-gray-400 transition-transform duration-200 ${workflowCollapsed ? "-rotate-90" : ""}`} />
              </button>

              {!workflowCollapsed && (
                workflows.length === 0 ? (
                  <div className="py-10 flex items-center justify-center text-gray-400 text-sm">
                    当前分类暂无工作流
                  </div>
                ) : (
                  /* 移动端：横向工作流标签条；桌面端：左右结构 */
                  <div className="flex flex-col sm:flex-row min-h-[200px] sm:min-h-[240px]">
                    {/* 工作流列表：移动端横向滚动，桌面端纵向左侧 */}
                    <div className="flex sm:flex-col sm:w-52 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-gray-50 overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto sm:py-2">
                      {workflows.map((wf) => (
                        <button
                          key={wf.id}
                          onClick={() => setActiveWorkflowId(wf.id)}
                          className={`shrink-0 sm:shrink text-left px-4 py-3 transition-all duration-150 whitespace-nowrap sm:whitespace-normal sm:border-l-2 border-b-2 sm:border-b-0 ${
                            activeWorkflowId === wf.id
                              ? "border-[#002FA7] bg-[#002FA7]/4 text-[#002FA7]"
                              : "border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                        >
                          <p className={`text-sm font-medium leading-tight ${activeWorkflowId === wf.id ? "text-[#002FA7]" : ""}`}>{wf.name}</p>
                          {wf.category && (
                            <p className="hidden sm:block text-[10px] mt-0.5 text-gray-400">{wf.category}</p>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* 右侧：步骤时间轴 */}
                    <div className="flex-1 px-5 py-4 overflow-y-auto">
                      {!activeWorkflow ? (
                        <div className="h-full flex items-center justify-center text-gray-400 text-sm">请选择工作流</div>
                      ) : activeWorkflow.workflow_steps.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-400 text-sm">该工作流暂无步骤</div>
                      ) : (
                        <>
                          {activeWorkflow.description && (
                            <p className="text-xs text-gray-400 mb-4 leading-relaxed">{activeWorkflow.description}</p>
                          )}
                          <div className="relative">
                            <div className="absolute left-[15px] top-5 bottom-5 w-px bg-gray-100" />
                            <div className="space-y-4">
                              {activeWorkflow.workflow_steps.map((step, idx) => (
                                <div key={step.id} className="flex gap-4 items-start relative">
                                  <div className="w-8 h-8 rounded-full bg-[#002FA7]/10 border-2 border-white ring-1 ring-gray-100 flex items-center justify-center shrink-0 z-10">
                                    <span className="text-xs font-bold text-[#002FA7]">{idx + 1}</span>
                                  </div>
                                  <div className="flex-1 min-w-0 pb-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-sm font-semibold text-gray-900">{step.title}</p>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 ${step.exec_type === "agent" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}>
                                        {step.exec_type === "agent" ? <><Bot size={9} />智能体</> : <><User size={9} />人工</>}
                                      </span>
                                    </div>
                                    {step.description && (
                                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
                                    )}
                                    {step.exec_type === "agent" ? (
                                      <WorkflowStepButton step={step} />
                                    ) : (
                                      <p className="mt-2 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-[8px] inline-block">此步骤需人工处理</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* ── 智能体展示 ─────────────────────────────────────────── */}
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const next = !agentCollapsed;
                setAgentCollapsed(next);
                try { localStorage.setItem("agent_collapsed", next ? "1" : "0"); } catch {}
              }}
              className="w-full flex items-center gap-2 px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors text-left"
            >
              <MessageSquare size={15} className="text-[#002FA7] shrink-0" />
              <span className="text-sm font-semibold text-gray-800">智能体展示</span>
              <span className="flex-1" />
              <ChevronDown size={15} className={`text-gray-400 transition-transform duration-200 ${agentCollapsed ? "-rotate-90" : ""}`} />
            </button>

            {!agentCollapsed && (
              <div className="p-5">
                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="bg-gray-50 rounded-[16px] p-5 h-40 animate-pulse">
                        <div className="w-11 h-11 bg-gray-100 rounded-[12px] mb-3" />
                        <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-gray-100 rounded w-full" />
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center">
                    <div className="w-14 h-14 rounded-[16px] bg-gray-100 flex items-center justify-center mb-4">
                      <MessageSquare size={24} className="text-gray-300" />
                    </div>
                    <p className="text-sm font-medium text-gray-500 mb-1">
                      {activeCategory === "__all__" ? "暂无可用智能体" : "该分类下暂无智能体"}
                    </p>
                    {activeCategory !== "__all__" && (
                      <button onClick={() => switchCategory("__all__")} className="mt-2 text-xs text-[#002FA7] hover:underline">
                        查看全部
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map((agent) => (
                      <AgentCard key={agent.agent_code} agent={agent} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      <footer className="border-t border-gray-100 bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">© 2024 前哨科技（QianShao.AI）保留所有权利</p>
          <div className="flex items-center gap-4">
            <button onClick={() => setContactOpen(true)} className="text-xs text-gray-400 hover:text-[#002FA7] transition-colors">联系我们</button>
            <Link href="/admin" className="text-[10px] text-gray-200 hover:text-gray-300 transition-colors" title="">·</Link>
          </div>
        </div>
      </footer>

      {contactOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setContactOpen(false)}>
          <div className="bg-white rounded-[20px] p-8 shadow-2xl flex flex-col items-center gap-4 w-72" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">联系我们</h3>
            <div className="w-40 h-40 bg-gray-100 rounded-[12px] flex items-center justify-center">
              <QrCode size={64} className="text-gray-300" />
            </div>
            <p className="text-xs text-gray-500 text-center">扫码添加微信，获取专属服务</p>
            <button onClick={() => setContactOpen(false)} className="text-sm text-gray-400 hover:text-gray-600">关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 智能体卡片（抽出组件，处理内链/外链两种类型）────────────────
function AgentCard({ agent }: { agent: AgentItem }) {
  const isExternal = agent.agent_type === "external";

  const cardClass =
    "group bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,47,167,0.12)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3 cursor-pointer";

  const cardContent = (
    <>
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center ${isExternal ? "bg-orange-50" : "bg-[#002FA7]/8"}`}>
          {isExternal
            ? <ExternalLink size={20} className="text-orange-500" />
            : <MessageSquare size={22} className="text-[#002FA7]" />}
        </div>
        <span className="text-[10px] text-gray-400 font-mono mt-1">{agent.agent_code}</span>
      </div>
      <div className="flex-1">
        <h3 className={`font-semibold text-gray-900 mb-1 transition-colors ${isExternal ? "group-hover:text-orange-500" : "group-hover:text-[#002FA7]"}`}>{agent.name}</h3>
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{agent.description}</p>
      </div>
      <div className="flex items-center justify-between pt-1">
        <Badge variant="muted">{agent.categories?.name ?? "通用"}</Badge>
        <div className={`flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity ${isExternal ? "text-orange-500" : "text-[#002FA7]"}`}>
          {isExternal ? <>外链跳转 <ExternalLink size={12} /></> : <>开始对话 <ChevronRight size={14} /></>}
        </div>
      </div>
    </>
  );

  if (isExternal) {
    // 外链地址为空时降级为不可点击
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
    <Link href={`/agents/${agent.agent_code}`} className={cardClass}>
      {cardContent}
    </Link>
  );
}

// ── 工作流步骤按钮 ────────────────────────────────────────────────
function WorkflowStepButton({ step }: { step: WorkflowStep }) {
  const agent = step.agents;

  // 未绑定智能体
  if (!step.agent_id) {
    return <p className="mt-2 text-xs text-gray-400 italic">未绑定智能体</p>;
  }

  // 智能体已被删除
  if (!agent) {
    return <p className="mt-2 text-xs text-red-400 bg-red-50 px-3 py-1.5 rounded-[8px] inline-block">智能体已删除，请联系管理员</p>;
  }

  const isExternal = agent.agent_type === "external";

  // 外链型但 URL 为空
  if (isExternal && !agent.external_url) {
    return <p className="mt-2 text-xs text-gray-400 italic">外链地址未配置</p>;
  }

  if (isExternal) {
    return (
      <a
        href={agent.external_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-orange-50 text-orange-600 hover:bg-orange-100"
      >
        <ExternalLink size={11} />
        {step.button_text}
        <ArrowRight size={11} />
      </a>
    );
  }

  return (
    <Link href={`/agents/${agent.agent_code}`} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-[#002FA7]/8 text-[#002FA7] hover:bg-[#002FA7]/15">
      <Bot size={11} />
      {step.button_text}
      <ArrowRight size={11} />
    </Link>
  );
}
