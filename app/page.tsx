"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mockNotices } from "@/lib/mock-data";
import { getFontSize, setFontSize, type FontSize } from "@/lib/font-size";
import {
  LogOut,
  Settings,
  QrCode,
  Megaphone,
  Zap,
  Menu,
  X,
  GitBranch,
  Bot,
  User as UserIcon,
  Building2,
  Eye,
  Wrench,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Type,
  Check,
  Pencil,
} from "lucide-react";
import { WorkflowStepButton } from "@/components/workflow-step-button";
import { AgentCard } from "@/components/agent-card";
import type { UserInfo, NoticeItem, WorkflowItem, AgentItem } from "@/lib/types";

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
  const [contactOpen, setContactOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // 字体大小快捷入口（与 settings 页同步，读写同一 localStorage）
  const pathname = usePathname();
  const [fontPopoverOpen, setFontPopoverOpen] = useState(false);
  const [fontSize, setFontSizeState] = useState<FontSize>("small");
  useEffect(() => {
    setFontSizeState(getFontSize());
  }, []);
  useEffect(() => {
    if (!fontPopoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFontPopoverOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fontPopoverOpen]);
  function changeFontSize(size: FontSize) {
    setFontSizeState(size);
    setFontSize(size, pathname);
    setFontPopoverOpen(false);
  }
  const [user, setUser] = useState<UserInfo | null>(null);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  // 4.30up 阶段一：activeWorkflowId === null 表示"全部"视图，渲染工作流卡片网格
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  // 5.9 工作流多会话
  type SessionItem = {
    id: string; name: string; currentStepIdx: number; totalSteps: number;
    status: string; updatedAt: string;
    workflow: { id: string; name: string } | null;
  };
  const [mySessions, setMySessions] = useState<SessionItem[]>([]);
  const [newSessionModal, setNewSessionModal] = useState<{
    workflowId: string; workflowName: string; inputName: string;
  } | null>(null);
  const [sessionCreating, setSessionCreating] = useState(false);
  const [renameModal, setRenameModal] = useState<{
    sessionId: string; originalName: string; inputName: string;
  } | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const newSessionInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (newSessionModal) newSessionInputRef.current?.focus({ preventScroll: true });
  }, [newSessionModal]);
  useEffect(() => {
    if (renameModal) renameInputRef.current?.focus({ preventScroll: true });
  }, [renameModal]);
  const [sessionsExpanded, setSessionsExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("wf_sessions_expanded") !== "0";
  });
  function toggleSessionsExpanded() {
    setSessionsExpanded((v) => {
      const next = !v;
      try { localStorage.setItem("wf_sessions_expanded", next ? "1" : "0"); } catch {}
      return next;
    });
  }
  // 横向滚动条引用 + 左右箭头可见状态
  const sessionsScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  function updateScrollArrows() {
    const el = sessionsScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  function scrollSessions(dir: "left" | "right") {
    const el = sessionsScrollRef.current;
    if (!el) return;
    const delta = el.clientWidth / 2 + 8; // 一张卡片宽度
    el.scrollBy({ left: dir === "left" ? -delta : delta, behavior: "smooth" });
  }
  // 滚轮垂直滚动转横向滚动
  function onSessionsWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = sessionsScrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 已经是横向滚轮就不干预
    el.scrollBy({ left: e.deltaY, behavior: "auto" });
    e.preventDefault();
  }
  useEffect(() => {
    if (!sessionsExpanded) return;
    const el = sessionsScrollRef.current;
    if (!el) return;
    updateScrollArrows();
    // 多次延迟兜底：初始 layout 在慢机器/字体冷加载时可能还没算完
    const t1 = setTimeout(updateScrollArrows, 50);
    const t2 = setTimeout(updateScrollArrows, 200);
    const t3 = setTimeout(updateScrollArrows, 500);
    // ResizeObserver 只在被观察元素自身尺寸变时触发；
    // 容器宽度恒等于父级，几乎不变，所以必须把每张卡也观察上，
    // 任何卡片实际尺寸变化都会触发重新测量
    const observer = new ResizeObserver(() => updateScrollArrows());
    observer.observe(el);
    Array.from(el.children).forEach((c) => observer.observe(c as Element));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      observer.disconnect();
    };
  }, [sessionsExpanded, mySessions]);
  // 初始值直接从 localStorage 读取，避免通知先显示再消失的闪烁
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return getDismissed();
  });
  const [loading, setLoading] = useState(true);
  const [siteSettings, setSiteSettings] = useState({
    logo_url: "",
    platform_name: "AI 智能体平台",
    help_doc_url: "",
    contact_qr_url: "",
    contact_qr_text: "扫码添加微信，获取专属服务",
  });

  useEffect(() => {
    async function load() {
      // 品牌配置（独立拉取，失败不影响主流程）
      fetch("/api/settings")
        .then((r) => r.json())
        .then((d) => setSiteSettings(d))
        .catch(() => {});

      try {
        const meRes = await fetch("/api/me", { cache: "no-store" });

        if (!meRes.ok) {
          // 4.30up：mock 兜底——保留未登录可见 demo UI 这条捷径，
          // 只 setUser / setNotices / setWorkflows([]) / setActiveWorkflowId(null)，
          // 不再 setAgents / setDisplayAgents / setCategories
          setUser({
            userId: "mock-user",
            phone: "138****8888",
            tenantCode: "DEMO2024",
            tenantName: "前哨科技示例企业",
            isPersonal: false,
            role: "user",
            userType: "organization",
            quota: { total: 500, used: 127, left: 373, expiresAt: "2025-12-31" },
          });
          setNotices(
            mockNotices.map((n) => ({
              id: n.id,
              tenant_code: n.type === "enterprise" ? "DEMO2024" : null,
              content: n.content,
              enabled: n.enabled,
            }))
          );
          setWorkflows([]);
          setActiveWorkflowId(null);
          return;
        }

        const meData = await meRes.json();
        setUser(meData);

        const [noticesData, workflowsData, sessionsData] = await Promise.all([
          fetch(`/api/notices?tenantCode=${meData.tenantCode}`)
            .then((r) => r.json())
            .catch(() => []),
          fetch("/api/workflows")
            .then((r) => r.json())
            .catch(() => []),
          fetch("/api/workflow-sessions")
            .then((r) => r.ok ? r.json() : [])
            .catch(() => []),
        ]);
        setMySessions(Array.isArray(sessionsData) ? sessionsData : []);
        setNotices(Array.isArray(noticesData) ? noticesData : []);
        const wfs: WorkflowItem[] = Array.isArray(workflowsData) ? workflowsData : [];
        setWorkflows(wfs);
        // 4.30up 导航流：从聊天页"返回"过来 ?wf=<id> → 直接进入对应工作流详情，
        // 实现 1→2→3→2→1 的来回路径
        const wfParam = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("wf")
          : null;
        if (wfParam && wfs.find((w) => w.id === wfParam)) {
          setActiveWorkflowId(wfParam);
        } else {
          setActiveWorkflowId(null); // 默认"全部"
        }
      } catch {
        // 网络错 → 仅保留 notices 兜底
        setNotices(
          mockNotices.map((n) => ({
            id: n.id,
            tenant_code: null,
            content: n.content,
            enabled: n.enabled,
          }))
        );
        setWorkflows([]);
        setActiveWorkflowId(null);
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

  function selectWorkflow(wfId: string | null) {
    setActiveWorkflowId(wfId);
    setSidebarOpen(false);
    // 同步 URL —— 否则刷新会读到旧的 ?wf=xxx 把你弹回上次的工作流详情
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (wfId) url.searchParams.set("wf", wfId);
      else url.searchParams.delete("wf");
      window.history.replaceState(null, "", url.toString());
    }
  }

  // 5.9 工作流多会话
  function openNewSessionModal(wf: WorkflowItem) {
    setNewSessionModal({
      workflowId: wf.id,
      workflowName: wf.name,
      inputName: `${wf.name} · ${new Date().toLocaleDateString("zh-CN")}`,
    });
  }

  async function createAndStartSession() {
    if (!newSessionModal || sessionCreating) return;
    setSessionCreating(true);
    try {
      const res = await fetch("/api/workflow-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: newSessionModal.workflowId, name: newSessionModal.inputName }),
      });
      if (!res.ok) return;
      const session = await res.json();
      const wf = workflows.find((w) => w.id === newSessionModal.workflowId);
      if (!wf) return;
      // 找到第一个有效的 agent 步骤
      const firstIdx = wf.workflow_steps.findIndex((s) => s.exec_type === "agent" && s.agents?.agent_code);
      if (firstIdx < 0) return;
      const firstStep = wf.workflow_steps[firstIdx];
      window.location.assign(
        `/agents/${encodeURIComponent(firstStep.agents!.agent_code)}?wf=${encodeURIComponent(wf.id)}&step=${firstIdx}&session=${encodeURIComponent(session.id)}`
      );
    } finally {
      setSessionCreating(false);
    }
  }

  function resumeSession(s: SessionItem) {
    if (!s.workflow) return;
    const wf = workflows.find((w) => w.id === s.workflow!.id);
    if (!wf) return;
    // 从记录的步骤开始往后找第一个有效 agent 步骤
    let idx = s.currentStepIdx;
    while (idx < wf.workflow_steps.length) {
      const step = wf.workflow_steps[idx];
      if (step.exec_type === "agent" && step.agents?.agent_code) break;
      idx++;
    }
    if (idx >= wf.workflow_steps.length) return;
    const step = wf.workflow_steps[idx];
    window.location.assign(
      `/agents/${encodeURIComponent(step.agents!.agent_code)}?wf=${encodeURIComponent(s.workflow!.id)}&step=${idx}&session=${encodeURIComponent(s.id)}`
    );
  }

  async function deleteSession(sessionId: string) {
    await fetch(`/api/workflow-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    setMySessions((prev) => prev.filter((s) => s.id !== sessionId));
  }

  function openRenameModal(s: SessionItem) {
    setRenameModal({ sessionId: s.id, originalName: s.name, inputName: s.name });
  }

  async function submitRename() {
    if (!renameModal || renameSaving) return;
    const newName = renameModal.inputName.trim();
    if (!newName || newName === renameModal.originalName) {
      setRenameModal(null);
      return;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/workflow-sessions/${encodeURIComponent(renameModal.sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) return;
      setMySessions((prev) => prev.map((s) => s.id === renameModal.sessionId ? { ...s, name: newName } : s));
      setRenameModal(null);
    } finally {
      setRenameSaving(false);
    }
  }

  const quota = user?.quota;
  const visibleNotices = notices.filter((n) => n.enabled && !dismissedNotices.has(n.id));
  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId) ?? null;

  // 当前工作流绑定的智能体（按步骤顺序去重，仅取真正绑定到 step.agents 的）
  // 注意：`/api/workflows` 嵌入的 agent 字段较薄（id/agent_code/name/agent_type/external_url），
  // 没有 description / platform / categories，AgentCard 渲染时这些位置会留空。
  // 阶段一不动后端，可接受；后续要补字段再扩接口。
  const workflowAgents: AgentItem[] = (() => {
    if (!activeWorkflow) return [];
    const seen = new Set<string>();
    const out: AgentItem[] = [];
    for (const step of activeWorkflow.workflow_steps) {
      const a = step.agents;
      if (!a || seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({
        id: a.id,
        agent_code: a.agent_code,
        name: a.name,
        description: "",
        platform: "",
        agent_type: a.agent_type,
        external_url: a.external_url,
      });
    }
    return out;
  })();

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      {/* 浅色环境光晕（与体验版一致） */}
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#7a93ff]/30 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 -right-48 w-[640px] h-[640px] rounded-full bg-[#8da4ff]/35 blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[420px] h-[420px] rounded-full bg-[#a4b8ff]/40 blur-[140px] pointer-events-none" />

      <header className="relative z-40 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 sticky top-0 shadow-[0_4px_20px_rgba(0,47,167,0.12)]">
        <div className="max-w-[1600px] mx-auto px-5 sm:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 rounded-[10px] hover:bg-white/10"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu size={22} className="text-white/85" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-[12px] overflow-hidden shrink-0 flex items-center justify-center bg-gradient-to-br from-[#002FA7] to-[#1a47c0] shadow-[0_4px_12px_rgba(0,47,167,0.25)]">
                {siteSettings.logo_url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={siteSettings.logo_url}
                      alt="Logo"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement!
                          .querySelector("span")
                          ?.removeAttribute("hidden");
                      }}
                    />
                    <span hidden className="text-white text-sm font-bold">
                      AI
                    </span>
                  </>
                ) : (
                  <span className="text-white text-sm font-bold">AI</span>
                )}
              </div>
              <div className="hidden sm:block">
                <p className="text-[18px] font-bold text-white leading-tight tracking-tight">
                  {siteSettings.platform_name || "AI 智能体平台"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {user && (
              <div className="hidden sm:flex items-center gap-2">
                {user.role === "super_admin" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-200 font-medium">
                    超级管理员
                  </span>
                )}
                {user.role === "system_admin" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-200 font-medium">
                    系统管理员
                  </span>
                )}
                {user.role === "org_admin" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-300/20 text-indigo-100 font-medium">
                    组织管理员
                  </span>
                )}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/15 rounded-[10px]">
                  {user.isPersonal ? (
                    <UserIcon size={14} className="text-white" />
                  ) : (
                    <Building2 size={14} className="text-white" />
                  )}
                  <span className="text-xs font-medium text-white">
                    {user.isPersonal ? "个人空间" : user.tenantName}
                  </span>
                  {!user.isPersonal && (
                    <span className="text-xs text-white/55">{user.tenantCode}</span>
                  )}
                </div>
              </div>
            )}

            {quota && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-[10px]">
                <Zap size={13} className="text-amber-300" />
                <span className="text-xs text-white/85">剩余 {quota.left} 次</span>
                <span className="text-xs text-white/55">· 至 {quota.expiresAt}</span>
              </div>
            )}

            <div className="flex items-center gap-1 ml-1">
              {/* 字体大小快捷入口 */}
              <div className="relative">
                <button
                  onClick={() => setFontPopoverOpen((v) => !v)}
                  className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-white/10 text-white/85 hover:text-white transition-colors"
                  title="字体大小"
                  aria-label="字体大小"
                  aria-haspopup="menu"
                  aria-expanded={fontPopoverOpen}
                >
                  <Type size={20} />
                </button>
                {fontPopoverOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setFontPopoverOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1.5 z-50 w-[160px] bg-white rounded-[12px] border border-gray-200 shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1.5 overflow-hidden"
                    >
                      <p className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                        字体大小
                      </p>
                      {(
                        [
                          { value: "small" as const, label: "小" },
                          { value: "medium" as const, label: "中" },
                          { value: "large" as const, label: "大" },
                        ]
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          role="menuitem"
                          onClick={() => changeFontSize(opt.value)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 ${
                            fontSize === opt.value
                              ? "text-[#002FA7] font-medium"
                              : "text-gray-700"
                          }`}
                        >
                          <span className="flex-1 text-left">{opt.label}</span>
                          {fontSize === opt.value && (
                            <Check size={14} className="text-[#002FA7]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {siteSettings.help_doc_url && (
                <a
                  href={siteSettings.help_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-white/10 text-white/85 hover:text-white transition-colors"
                  title="帮助文档"
                  aria-label="帮助文档"
                >
                  <BookOpen size={20} />
                </a>
              )}
              <button
                onClick={() => setContactOpen(true)}
                className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-white/10 text-white/85 hover:text-white transition-colors"
                title="联系我们"
                aria-label="联系我们"
              >
                <QrCode size={20} />
              </button>
              <Link
                href="/settings"
                className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-white/10 text-white/85 hover:text-white transition-colors"
                title="账号设置"
                aria-label="账号设置"
              >
                <Settings size={20} />
              </Link>
              <button
                onClick={handleLogout}
                className="w-10 h-10 flex items-center justify-center rounded-[10px] hover:bg-white/10 text-white/85 hover:text-red-200 transition-colors"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex-1 max-w-[1600px] mx-auto w-full px-5 sm:px-8 py-6 flex gap-7">
        {/* 4.30up 阶段一：左侧改为"我的工作流" */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-60 bg-white shadow-xl p-6 flex flex-col gap-4 transform transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:shadow-none lg:bg-transparent lg:p-0 lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between lg:hidden mb-2">
            <span className="font-semibold text-gray-900">我的工作流</span>
            <button onClick={() => setSidebarOpen(false)}>
              <X size={20} className="text-gray-500" />
            </button>
          </div>
          <div className="hidden lg:block text-xs font-semibold text-[#002FA7]/55 uppercase tracking-wider mb-2">
            我的工作流
          </div>
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => selectWorkflow(null)}
              className={`group/item relative flex items-center px-3.5 py-2.5 rounded-[10px] text-[14px] transition-all duration-150 ${
                activeWorkflowId === null
                  ? "bg-[#002FA7]/10 text-[#002FA7] font-semibold"
                  : "text-gray-600 font-medium hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-[#002FA7] rounded-r transition-all duration-200 ${
                  activeWorkflowId === null ? "h-5" : "h-0 group-hover/item:h-5"
                }`}
              />
              全部
            </button>

            {workflows.map((wf) => (
              <button
                key={wf.id}
                onClick={() => selectWorkflow(wf.id)}
                className={`group/item relative flex items-center px-3.5 py-2.5 rounded-[10px] text-[14px] text-left transition-all duration-150 ${
                  activeWorkflowId === wf.id
                    ? "bg-[#002FA7]/10 text-[#002FA7] font-semibold"
                    : "text-gray-600 font-medium hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-[#002FA7] rounded-r transition-all duration-200 ${
                    activeWorkflowId === wf.id ? "h-5" : "h-0 group-hover/item:h-5"
                  }`}
                />
                <span className="truncate">{wf.name}</span>
              </button>
            ))}

            {!loading && workflows.length === 0 && (
              <div className="px-3.5 py-3 text-xs text-gray-400">暂无工作流</div>
            )}
          </nav>
        </aside>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 min-w-0 page-enter">
          {/* ── 通知栏 ─────────────────────────────────────────────── */}
          {visibleNotices.length > 0 && (
            <div className="mb-6 space-y-2">
              {visibleNotices.map((notice) => (
                <div
                  key={notice.id}
                  className={`relative flex items-start gap-3 p-4 pr-10 rounded-[14px] text-sm shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${
                    notice.tenant_code
                      ? "bg-white/90 border border-[#002FA7]/15"
                      : "bg-amber-50/95 border border-amber-200"
                  }`}
                >
                  <Megaphone
                    size={16}
                    className={`mt-0.5 shrink-0 ${
                      notice.tenant_code ? "text-[#002FA7]" : "text-amber-500"
                    }`}
                  />
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

          {/* ── 5.9 我的进行中工作流 ────────────────────────────────── */}
          {!loading && mySessions.length > 0 && activeWorkflowId === null && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={toggleSessionsExpanded}
                  className="flex items-center gap-2 text-left group"
                  aria-expanded={sessionsExpanded}
                >
                  <span className="w-5 h-5 rounded-full bg-[#002FA7]/10 flex items-center justify-center shrink-0">
                    <GitBranch size={11} className="text-[#002FA7]" />
                  </span>
                  <h2 className="text-[15px] font-semibold text-gray-900">我的进行中工作流</h2>
                  <span className="text-[12px] text-gray-400">({mySessions.length})</span>
                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition-transform group-hover:text-gray-600 ${sessionsExpanded ? "" : "-rotate-90"}`}
                  />
                </button>
                {sessionsExpanded && (canScrollLeft || canScrollRight) && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => scrollSessions("left")}
                      disabled={!canScrollLeft}
                      className="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-[#002FA7] hover:border-[#002FA7]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="向左滚动"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollSessions("right")}
                      disabled={!canScrollRight}
                      className="w-7 h-7 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-[#002FA7] hover:border-[#002FA7]/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="向右滚动"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}
              </div>
              {sessionsExpanded && (
                <div
                  ref={sessionsScrollRef}
                  onScroll={updateScrollArrows}
                  onWheel={onSessionsWheel}
                  className="flex gap-2 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1 [&::-webkit-scrollbar]:hidden"
                  style={{ scrollbarWidth: "none" }}
                >
                  {mySessions.map((s) => (
                    <div
                      key={s.id}
                      className={`snap-start shrink-0 ${mySessions.length === 1 ? "w-full" : "w-[calc(50%-4px)]"} bg-white border border-gray-200 rounded-[12px] px-4 py-2.5 flex items-center gap-3 shadow-[0_1px_4px_rgba(0,0,0,0.03)] hover:border-[#002FA7]/30 transition-colors`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{s.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {s.workflow?.name ?? "工作流"} · 第 {s.currentStepIdx + 1}/{s.totalSteps} 步 · {new Date(s.updatedAt).toLocaleDateString("zh-CN")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => resumeSession(s)}
                          className="px-3 py-1 rounded-full text-[12px] font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors"
                        >
                          继续
                        </button>
                        <button
                          onClick={() => openRenameModal(s)}
                          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-[#002FA7] hover:bg-[#002FA7]/10 transition-colors"
                          title="重命名"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => deleteSession(s.id)}
                          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="删除此会话"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── 主区：activeWorkflowId === null → 工作流卡片网格 ───────── */}
          {activeWorkflowId === null ? (
            loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-white/80 border border-gray-200 rounded-[20px] p-5 h-40 animate-pulse shadow-[0_2px_10px_rgba(0,0,0,0.04)]"
                  >
                    <div className="w-11 h-11 bg-gray-100 rounded-[12px] mb-3" />
                    <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-full" />
                  </div>
                ))}
              </div>
            ) : workflows.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] py-20 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-[16px] bg-gray-100 flex items-center justify-center mb-4">
                  <GitBranch size={24} className="text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">暂无可用工作流</p>
                <p className="text-xs text-gray-400 mt-1">请联系管理员配置工作流</p>
              </div>
            ) : (
              <>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-[#002FA7]/10 flex items-center justify-center shrink-0">
                  <GitBranch size={11} className="text-[#002FA7]" />
                </span>
                <h2 className="text-[15px] font-semibold text-gray-900">全部工作流</h2>
                <span className="text-[12px] text-gray-400">({workflows.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {workflows.map((wf) => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => selectWorkflow(wf.id)}
                    className="group relative overflow-hidden bg-gradient-to-br from-[#001f7a] via-[#002FA7] to-[#3b5fff] rounded-[20px] p-6 transition-all duration-500 flex flex-col gap-4 cursor-pointer text-left hover:-translate-y-1 shadow-[0_4px_16px_rgba(0,47,167,0.2)] hover:shadow-[0_24px_60px_rgba(59,95,255,0.45)]"
                  >
                    {/* 多层光晕 + 高光（与体验版智能体卡同款） */}
                    <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-[#6b87ff]/40 blur-[60px] pointer-events-none transition-all duration-500 group-hover:bg-[#a4b8ff]/55 group-hover:scale-110" />
                    <div className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#3b5fff]/35 blur-[70px] pointer-events-none transition-all duration-500 group-hover:bg-[#6b87ff]/45" />
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

                    <div className="relative">
                      <div className="w-12 h-12 rounded-[14px] flex items-center justify-center bg-white/15 border border-white/20 backdrop-blur shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                        <GitBranch size={22} className="text-white" />
                      </div>
                    </div>

                    <div className="relative flex-1 min-h-0">
                      <h3 className="text-[16px] font-semibold text-white mb-2 leading-snug">
                        {wf.name}
                      </h3>
                      {wf.description && (
                        <p className="text-[13px] text-white/75 leading-relaxed line-clamp-2">
                          {wf.description}
                        </p>
                      )}
                    </div>

                    <div className="relative flex items-center justify-between pt-2 border-t border-white/15">
                      <span className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-full bg-white/15 text-white border border-white/20">
                        {wf.category || "工作流"}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[12px] text-white/80 group-hover:text-white transition-colors">
                        查看流程 <ChevronRight size={12} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              </>
            )
          ) : (
            /* ── 主区：选中某条工作流 → 详情 + 智能体展示 ───────────────── */
            <>
            <div className="bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center gap-3.5 px-7 py-5 border-b border-gray-50">
                <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-[#002FA7] to-[#1a47c0] flex items-center justify-center shadow-[0_4px_12px_rgba(0,47,167,0.25)] shrink-0">
                  <GitBranch size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[18px] font-semibold text-gray-900 leading-tight truncate">
                    {activeWorkflow?.name ?? "工作流"}
                  </p>
                  {activeWorkflow?.category && (
                    <p className="text-[13px] text-gray-500 mt-1">{activeWorkflow.category}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activeWorkflow && (
                    <button
                      onClick={() => openNewSessionModal(activeWorkflow)}
                      className="text-xs font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] px-3 py-1.5 rounded-[8px] transition-colors"
                    >
                      开始新会话
                    </button>
                  )}
                  <button
                    onClick={() => selectWorkflow(null)}
                    className="text-xs text-gray-500 hover:text-[#002FA7] px-3 py-1.5 rounded-[8px] hover:bg-gray-100 transition-colors"
                  >
                    返回全部
                  </button>
                </div>
              </div>

              <div className="px-7 py-6">
                {!activeWorkflow ? (
                  <div className="py-14 flex items-center justify-center text-gray-400 text-sm">
                    工作流不存在或已被移除
                  </div>
                ) : activeWorkflow.workflow_steps.length === 0 ? (
                  <div className="py-14 flex items-center justify-center text-gray-400 text-sm">
                    该工作流暂无步骤
                  </div>
                ) : (
                  <>
                    {activeWorkflow.description && (
                      <p className="text-[13px] text-gray-500 mb-6 leading-relaxed">
                        {activeWorkflow.description}
                      </p>
                    )}
                    <div className="relative">
                      <div className="absolute left-[15px] top-8 bottom-3 w-px bg-gray-100" />
                      <div className="space-y-5">
                        {activeWorkflow.workflow_steps.map((step, idx) => (
                          <div key={step.id} className="flex gap-4 items-start relative">
                            <div className="w-8 h-8 rounded-full border-2 border-white ring-1 ring-gray-100 flex items-center justify-center shrink-0 z-10 mt-0.5 bg-[#002FA7]/10">
                              <span className="text-[12px] font-bold text-[#002FA7]">{idx + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0 flex items-start gap-3 py-0.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[15px] font-semibold text-gray-900">
                                    {step.title}
                                  </span>
                                  <span
                                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0 ${
                                      step.exec_type === "agent"
                                        ? "bg-blue-50 text-blue-600"
                                        : step.exec_type === "manual"
                                        ? "bg-amber-50 text-amber-600"
                                        : step.exec_type === "review"
                                        ? "bg-purple-50 text-purple-600"
                                        : "bg-gray-50 text-gray-600"
                                    }`}
                                  >
                                    {step.exec_type === "agent" && (
                                      <>
                                        <Bot size={11} />
                                        智能体
                                      </>
                                    )}
                                    {step.exec_type === "manual" && (
                                      <>
                                        <UserIcon size={11} />
                                        人工执行
                                      </>
                                    )}
                                    {step.exec_type === "review" && (
                                      <>
                                        <Eye size={11} />
                                        人工审核
                                      </>
                                    )}
                                    {step.exec_type === "external" && (
                                      <>
                                        <Wrench size={11} />
                                        外部工具
                                      </>
                                    )}
                                  </span>
                                </div>
                                {step.description && (
                                  <p className="text-[13px] text-gray-500 leading-relaxed mt-1.5">
                                    {step.description}
                                  </p>
                                )}
                              </div>
                              <div
                                className="shrink-0 flex justify-end"
                                style={{ minWidth: 148 }}
                              >
                                {step.exec_type === "agent" ? (
                                  <WorkflowStepButton
                                    step={step}
                                    fromWorkflow={activeWorkflow?.id}
                                    stepIndex={idx}
                                  />
                                ) : step.exec_type === "manual" ? (
                                  <span className="text-[12px] text-amber-600 bg-amber-50 px-3 py-1.5 rounded-[8px]">
                                    此步骤需人工处理
                                  </span>
                                ) : step.exec_type === "review" ? (
                                  <span className="text-[12px] text-purple-600 bg-purple-50 px-3 py-1.5 rounded-[8px]">
                                    此步骤需人工审核
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-gray-600 bg-gray-50 px-3 py-1.5 rounded-[8px]">
                                    使用外部工具处理
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 4.30up：智能体展示卡 — 仅本工作流绑定的智能体 */}
            {activeWorkflow && workflowAgents.length > 0 && (
              <div className="mt-6 bg-white border border-gray-200 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="flex items-center gap-3.5 px-7 py-5 border-b border-gray-50">
                  <div className="w-11 h-11 rounded-[12px] bg-gradient-to-br from-[#002FA7] to-[#1a47c0] flex items-center justify-center shadow-[0_4px_12px_rgba(0,47,167,0.25)] shrink-0">
                    <Bot size={22} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[18px] font-semibold text-gray-900 leading-tight">智能体展示</p>
                    <p className="text-[13px] text-gray-500 mt-1">
                      该工作流绑定的智能体，共 {workflowAgents.length} 个
                    </p>
                  </div>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {workflowAgents.map((agent) => (
                      <AgentCard key={agent.agent_code} agent={agent} fromWorkflow={activeWorkflow?.id} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            </>
          )}
        </main>
      </div>

      <footer className="relative z-10 border-t border-white/40 bg-white/60 backdrop-blur-sm mt-auto">
        <div className="max-w-[1600px] mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">© 2026 前哨科技（QianShao.AI）保留所有权利</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setContactOpen(true)}
              className="text-xs text-gray-400 hover:text-[#002FA7] transition-colors"
            >
              联系我们
            </button>
            <Link
              href="/admin"
              className="text-[10px] text-gray-200 hover:text-gray-300 transition-colors"
              title=""
            >
              ·
            </Link>
          </div>
        </div>
      </footer>

      {contactOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setContactOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="联系我们"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl flex flex-col items-center gap-4 w-72"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900">联系我们</h3>
            <div className="w-40 h-40 bg-gray-100 rounded-[12px] flex items-center justify-center overflow-hidden">
              {siteSettings.contact_qr_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={siteSettings.contact_qr_url}
                  alt="联系二维码"
                  className="w-full h-full object-contain"
                />
              ) : (
                <QrCode size={64} className="text-gray-300" />
              )}
            </div>
            {siteSettings.contact_qr_text && (
              <p className="text-xs text-gray-500 text-center">{siteSettings.contact_qr_text}</p>
            )}
            <button
              onClick={() => setContactOpen(false)}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ── 5.9 新建工作流会话弹窗 ─────────────────────────────── */}
      {newSessionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setNewSessionModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl w-[420px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 text-lg mb-1">开始新的工作流</h3>
            <p className="text-sm text-gray-400 mb-5">{newSessionModal.workflowName}</p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">会话名称</label>
            <input
              ref={newSessionInputRef}
              type="text"
              value={newSessionModal.inputName}
              onChange={(e) => setNewSessionModal((m) => m ? { ...m, inputName: e.target.value } : m)}
              onKeyDown={(e) => { if (e.key === "Enter") createAndStartSession(); }}
              className="w-full border border-gray-200 rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60 mb-6"
              placeholder="例如：项目A资料整理"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setNewSessionModal(null)}
                className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={createAndStartSession}
                disabled={sessionCreating || !newSessionModal.inputName.trim()}
                className="px-6 py-2 rounded-[10px] text-sm font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sessionCreating ? "创建中…" : "开始"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5.9 重命名工作流会话弹窗 ─────────────────────────────── */}
      {renameModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setRenameModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl w-[420px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 text-lg mb-1">重命名会话</h3>
            <p className="text-sm text-gray-400 mb-5 truncate">原名称：{renameModal.originalName}</p>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">新名称</label>
            <input
              ref={renameInputRef}
              type="text"
              value={renameModal.inputName}
              onChange={(e) => setRenameModal((m) => m ? { ...m, inputName: e.target.value } : m)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") setRenameModal(null);
              }}
              className="w-full border border-gray-200 rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#002FA7]/30 focus:border-[#002FA7]/60 mb-6"
              placeholder="输入新的会话名称"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRenameModal(null)}
                className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitRename}
                disabled={renameSaving || !renameModal.inputName.trim()}
                className="px-6 py-2 rounded-[10px] text-sm font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {renameSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
