"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
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
  Megaphone,
  Zap,
  Menu,
  X,
  ExternalLink,
  GitBranch,
  Bot,
  User,
  ArrowRight,
  Plus,
  Trash2,
  Edit2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// 动态导入 ChevronDown，关闭 SSR，避免 localStorage 初始化状态导致的 Hydration 不一致
const ChevronDown = dynamic(
  () => import("lucide-react").then((m) => m.ChevronDown),
  { ssr: false }
);

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
type UserAgentItem = {
  id: string;
  name: string;
  description: string;
  agent_type: "chat" | "external";
  platform: string;
  api_url: string;
  external_url: string;
};
const EMPTY_UA_FORM = { name: "", description: "", agentType: "chat" as "chat" | "external", platform: "openai", apiUrl: "", apiKey: "", externalUrl: "" };

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
  const [displayAgents, setDisplayAgents] = useState<AgentItem[]>([]); // 当前分类展示集合
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
  const [myAgentsCollapsed, setMyAgentsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem("my_agents_collapsed") === "1"; } catch { return false; }
  });
  const [userAgents, setUserAgents] = useState<UserAgentItem[]>([]);
  const [showMyAgentsSettings, setShowMyAgentsSettings] = useState(false);
  const [editingUA, setEditingUA] = useState<UserAgentItem | null>(null);
  const [uaForm, setUaForm] = useState(EMPTY_UA_FORM);
  const [uaSaving, setUaSaving] = useState(false);
  const [uaError, setUaError] = useState("");
  // 初始值直接从 localStorage 读取，避免通知先显示再消失的闪烁
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return getDismissed();
  });
  const [loading, setLoading] = useState(true);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "AI 智能体平台" });

  useEffect(() => {
    async function load() {
      // 品牌配置（独立拉取，失败不影响主流程）
      fetch("/api/settings")
        .then((r) => r.json())
        .then((d) => setSiteSettings(d))
        .catch(() => {});

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
          const mockMapped = mockAgents.map((a) => ({
            id: a.id,
            agent_code: a.id,
            name: a.name,
            description: a.description,
            platform: a.platform,
            agent_type: "chat",
            external_url: "",
            categories: { name: a.categoryName },
          }));
          setAgents(mockMapped);
          setDisplayAgents(mockMapped);
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
        const allAgents = agentsData.agents ?? [];
        setAgents(allAgents);
        setDisplayAgents(allAgents); // 初始"全部"时展示全部
        setCategories(agentsData.categories ?? []);

        const [noticesData, workflowsData, userAgentsData] = await Promise.all([
          fetch(`/api/notices?tenantCode=${meData.tenantCode}`).then((r) => r.json()).catch(() => []),
          fetch("/api/workflows").then((r) => r.json()).catch(() => []),
          fetch("/api/user-agents").then((r) => r.json()).catch(() => []),
        ]);
        setNotices(noticesData);

        const wfs: WorkflowItem[] = Array.isArray(workflowsData) ? workflowsData : [];
        setWorkflows(wfs);
        setActiveWorkflowId(wfs.length > 0 ? wfs[0].id : null);
        setUserAgents(Array.isArray(userAgentsData) ? userAgentsData : []);
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
  // 展示集合由服务端计算好，直接使用
  const filtered = displayAgents;

  async function switchCategory(catId: string) {
    setActiveCategory(catId);
    setSidebarOpen(false);

    // 并行刷新：工作流 + 智能体展示
    const wfUrl = catId === "__all__" ? "/api/workflows" : `/api/workflows?categoryId=${catId}`;
    const agentUrl = catId === "__all__" ? "/api/agents" : `/api/agents?categoryId=${catId}`;

    const [wfs, agentsData] = await Promise.all([
      fetch(wfUrl).then((r) => r.json()).catch(() => []),
      fetch(agentUrl).then((r) => r.json()).catch(() => ({ agents: [] })),
    ]);

    const wfList: WorkflowItem[] = Array.isArray(wfs) ? wfs : [];
    setWorkflows(wfList);
    setActiveWorkflowId(wfList.length > 0 ? wfList[0].id : null);

    // 全部 → 用完整智能体列表；特定分类 → 用服务端计算结果
    if (catId === "__all__") {
      setDisplayAgents(agents);
    } else {
      setDisplayAgents(agentsData.agents ?? []);
    }
  }

  async function refreshUserAgents() {
    const data = await fetch("/api/user-agents").then((r) => r.json()).catch(() => []);
    setUserAgents(Array.isArray(data) ? data : []);
  }

  function openAddUA() { setEditingUA(null); setUaForm(EMPTY_UA_FORM); setUaError(""); }
  function openEditUA(a: UserAgentItem) {
    setEditingUA(a);
    setUaForm({ name: a.name, description: a.description, agentType: a.agent_type, platform: a.platform, apiUrl: a.api_url, apiKey: "", externalUrl: a.external_url });
    setUaError("");
  }

  async function saveUA() {
    setUaError("");
    if (!uaForm.name.trim()) { setUaError("请填写名称"); return; }
    if (uaForm.agentType === "external" && !uaForm.externalUrl.trim()) { setUaError("请填写跳转链接"); return; }
    setUaSaving(true);
    try {
      const body = { name: uaForm.name, description: uaForm.description, agentType: uaForm.agentType, platform: uaForm.platform, apiUrl: uaForm.apiUrl, apiKey: uaForm.apiKey || undefined, externalUrl: uaForm.externalUrl };
      const res = editingUA
        ? await fetch(`/api/user-agents/${editingUA.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/user-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setUaError(data.error ?? "保存失败"); return; }
      setEditingUA(null);
      setUaForm(EMPTY_UA_FORM);
      await refreshUserAgents();
    } finally { setUaSaving(false); }
  }

  async function deleteUA(id: string) {
    if (!confirm("确认删除此智能体？")) return;
    await fetch(`/api/user-agents/${id}`, { method: "DELETE" });
    await refreshUserAgents();
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
              <div className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-[#002FA7]">
                {siteSettings.logo_url ? (
                  <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-white text-xs font-bold">AI</span>
                )}
              </div>
              <span className="font-semibold text-gray-900 hidden sm:block">
                {siteSettings.platform_name || "AI 智能体平台"}
              </span>
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
            <span className="font-semibold text-gray-900">我的工作任务</span>
            <button onClick={() => setSidebarOpen(false)}><X size={20} className="text-gray-500" /></button>
          </div>
          <div className="hidden lg:block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">我的工作任务</div>
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
                            <div className="absolute left-[13px] top-6 bottom-2 w-px bg-gray-100" />
                            <div className="space-y-1.5">
                              {activeWorkflow.workflow_steps.map((step, idx) => (
                                <div key={step.id} className="flex gap-3 items-start relative">
                                  <div className="w-7 h-7 rounded-full bg-[#002FA7]/10 border-2 border-white ring-1 ring-gray-100 flex items-center justify-center shrink-0 z-10 mt-0.5">
                                    <span className="text-[11px] font-bold text-[#002FA7]">{idx + 1}</span>
                                  </div>
                                  {/* 横向紧凑布局：标题 + 类型标签 + 说明 + 按钮尽量排在一行 */}
                                  <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 pb-2.5">
                                    <span className="text-sm font-semibold text-gray-900 shrink-0">{step.title}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5 shrink-0 ${step.exec_type === "agent" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}>
                                      {step.exec_type === "agent" ? <><Bot size={9} />智能体</> : <><User size={9} />人工</>}
                                    </span>
                                    {step.description && (
                                      <span className="text-xs text-gray-400 leading-relaxed flex-1 min-w-[80px]">{step.description}</span>
                                    )}
                                    {step.exec_type === "agent" ? (
                                      <WorkflowStepButton step={step} />
                                    ) : (
                                      <span className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-[8px] shrink-0">此步骤需人工处理</span>
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
          {/* ── 我的智能体 ──────────────────────────────────────────── */}
          <div className="mt-6 bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="w-full flex items-center gap-2 px-5 py-3.5 border-b border-gray-50">
              <Bot size={15} className="text-[#002FA7] shrink-0" />
              <span className="text-sm font-semibold text-gray-800">我的智能体</span>
              <span className="flex-1" />
              <button
                onClick={() => { openAddUA(); setShowMyAgentsSettings(true); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-medium text-[#002FA7] hover:bg-[#002FA7]/8 transition-colors"
              >
                <Settings size={12} />
                设置
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !myAgentsCollapsed;
                  setMyAgentsCollapsed(next);
                  try { localStorage.setItem("my_agents_collapsed", next ? "1" : "0"); } catch {}
                }}
                className="p-1 rounded-[6px] hover:bg-gray-100 transition-colors"
              >
                <ChevronDown size={15} className={`text-gray-400 transition-transform duration-200 ${myAgentsCollapsed ? "-rotate-90" : ""}`} />
              </button>
            </div>

            {!myAgentsCollapsed && (
              <div className="p-5">
                {userAgents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="w-12 h-12 rounded-[14px] bg-gray-100 flex items-center justify-center mb-3">
                      <Bot size={22} className="text-gray-300" />
                    </div>
                    <p className="text-sm text-gray-400 mb-3">你还没有创建智能体</p>
                    <button
                      onClick={() => { openAddUA(); setShowMyAgentsSettings(true); }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#002FA7]/8 text-[#002FA7] text-xs font-medium hover:bg-[#002FA7]/15 transition-colors"
                    >
                      <Plus size={13} /> 新增智能体
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {userAgents.map((ua) => (
                      <UserAgentCard key={ua.id} agent={ua} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ── 我的智能体设置弹窗 ──────────────────────────────────────── */}
      {showMyAgentsSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">我的智能体</h2>
              <button onClick={() => { setShowMyAgentsSettings(false); setEditingUA(null); setUaForm(EMPTY_UA_FORM); setUaError(""); }} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 已有智能体列表 */}
              {userAgents.length > 0 && !editingUA && (
                <div className="space-y-2">
                  {userAgents.map((ua) => (
                    <div key={ua.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[12px]">
                      <div className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${ua.agent_type === "external" ? "bg-orange-50" : "bg-[#002FA7]/8"}`}>
                        {ua.agent_type === "external" ? <ExternalLink size={14} className="text-orange-500" /> : <Bot size={14} className="text-[#002FA7]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{ua.name}</p>
                        <p className="text-xs text-gray-400 truncate">{ua.agent_type === "external" ? "外链跳转" : ua.platform}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEditUA(ua)} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"><Edit2 size={13} /></button>
                        <button onClick={() => deleteUA(ua.id)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 新增 / 编辑表单：常驻显示，标题随编辑状态切换 */}
              <div className="border border-gray-100 rounded-[14px] p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">{editingUA ? "编辑智能体" : "新增智能体"}</p>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">名称 *</label>
                    <input className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder="智能体名称" value={uaForm.name} onChange={(e) => setUaForm({ ...uaForm, name: e.target.value })} />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">简介</label>
                    <input className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder="简短描述（可选）" value={uaForm.description} onChange={(e) => setUaForm({ ...uaForm, description: e.target.value })} />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">类型</label>
                    <div className="flex gap-3">
                      {(["chat", "external"] as const).map((t) => (
                        <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm">
                          <input type="radio" name="ua_type" value={t} checked={uaForm.agentType === t} onChange={() => setUaForm({ ...uaForm, agentType: t })} className="accent-[#002FA7]" />
                          {t === "chat" ? "API 对话型" : "链接跳转型"}
                        </label>
                      ))}
                    </div>
                  </div>

                  {uaForm.agentType === "chat" && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-gray-600">平台</label>
                        <select className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7]" value={uaForm.platform} onChange={(e) => setUaForm({ ...uaForm, platform: e.target.value })}>
                          {["openai", "coze", "dify", "qingyan", "yuanqi", "other"].map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-gray-600">API 地址</label>
                        <input className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder="https://api.openai.com/v1/chat/completions" value={uaForm.apiUrl} onChange={(e) => setUaForm({ ...uaForm, apiUrl: e.target.value })} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-gray-600">API Key {editingUA && <span className="font-normal text-gray-400">（留空则保持不变）</span>}</label>
                        <input type="password" className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder={editingUA ? "输入新 Key 覆盖" : "sk-..."} value={uaForm.apiKey} onChange={(e) => setUaForm({ ...uaForm, apiKey: e.target.value })} />
                      </div>
                    </>
                  )}

                  {uaForm.agentType === "external" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-gray-600">跳转链接 *</label>
                      <input className="h-9 border border-gray-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder="https://example.com/tool" value={uaForm.externalUrl} onChange={(e) => setUaForm({ ...uaForm, externalUrl: e.target.value })} />
                    </div>
                  )}

                  {uaError && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-[8px]">{uaError}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    {editingUA && <button onClick={() => { setEditingUA(null); setUaForm(EMPTY_UA_FORM); setUaError(""); }} className="px-4 py-2 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors">取消编辑</button>}
                    <button onClick={saveUA} disabled={uaSaving} className="px-4 py-2 rounded-[10px] text-sm font-medium bg-[#002FA7] text-white hover:bg-[#001f7a] transition-colors disabled:opacity-60">
                      {uaSaving ? "保存中…" : editingUA ? "保存修改" : "创建智能体"}
                    </button>
                  </div>
                </div>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-gray-100 bg-white mt-auto">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">© 2026 前哨科技（QianShao.AI）保留所有权利</p>
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

  return (
    <Link href={`/agents/${agent.agent_code}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors bg-[#002FA7]/8 text-[#002FA7] hover:bg-[#002FA7]/15 shrink-0">
      <Bot size={11} />
      {step.button_text}
      <ArrowRight size={11} />
    </Link>
  );
}

// ── 我的智能体卡片 ────────────────────────────────────────────────
function UserAgentCard({ agent }: { agent: UserAgentItem }) {
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
