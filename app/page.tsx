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
  Megaphone,
  Zap,
  Menu,
  X,
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
  categories?: { name: string };
};

type CategoryItem = { id: string; name: string };
type NoticeItem = { id: string; tenant_code: string | null; content: string; enabled: boolean };

export default function HomePage() {
  const [activeCategory, setActiveCategory] = useState("__all__");
  const [contactOpen, setContactOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
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

        // 加载公告
        const noticesData = await fetch(`/api/notices?tenantCode=${meData.tenantCode}`).then(
          (r) => r.json()
        ).catch(() => []);
        setNotices(noticesData);
      } catch {
        // fallback to mock
        setAgents(mockAgents.map((a) => ({
          id: a.id,
          agent_code: a.id,
          name: a.name,
          description: a.description,
          platform: a.platform,
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

  const allCats = [{ id: "__all__", name: "全部" }, ...categories];
  const filtered =
    activeCategory === "__all__"
      ? agents
      : agents.filter((a) => {
          // match by category name since IDs may differ
          const cat = categories.find((c) => c.id === activeCategory);
          return cat && a.categories?.name === cat.name;
        });

  const quota = user?.quota;

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
                onClick={() => { setActiveCategory(cat.id); setSidebarOpen(false); }}
                className={`flex items-center justify-between px-3 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-150 ${activeCategory === cat.id ? "bg-[#002FA7] text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                <span>{cat.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        <main className="flex-1 min-w-0 page-enter">
          {notices.filter((n) => n.enabled).length > 0 && (
            <div className="mb-6 space-y-2">
              {notices.filter((n) => n.enabled).map((notice) => (
                <div key={notice.id} className={`flex items-start gap-3 p-4 rounded-[12px] text-sm ${notice.tenant_code ? "bg-[#f0f4ff] border border-[#002FA7]/10" : "bg-amber-50 border border-amber-100"}`}>
                  <Megaphone size={16} className={`mt-0.5 shrink-0 ${notice.tenant_code ? "text-[#002FA7]" : "text-amber-500"}`} />
                  <p className="text-gray-700">{notice.content}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mb-3">
            <h2 className="text-sm font-semibold text-gray-700">{filtered.length} 个智能体</h2>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="bg-white rounded-[16px] p-5 h-40 animate-pulse">
                  <div className="w-11 h-11 bg-gray-100 rounded-[12px] mb-3" />
                  <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-gray-50 rounded w-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((agent) => (
                <Link
                  key={agent.agent_code}
                  href={`/agents/${agent.agent_code}`}
                  className="group bg-white rounded-[16px] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,47,167,0.12)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-[12px] bg-[#002FA7]/8 flex items-center justify-center">
                      <MessageSquare size={22} className="text-[#002FA7]" />
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono mt-1">{agent.agent_code}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1 group-hover:text-[#002FA7] transition-colors">{agent.name}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{agent.description}</p>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Badge variant="muted">{agent.categories?.name ?? "通用"}</Badge>
                    <div className="flex items-center gap-1 text-[#002FA7] text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      开始对话 <ChevronRight size={14} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
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
