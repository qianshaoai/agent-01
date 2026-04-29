"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Send,
  Loader2,
  MessageSquare,
  ChevronRight,
  ArrowLeft,
  LogOut,
  Plus,
  Trash2,
  MessageCircle,
  Paperclip,
  X,
  ImageIcon,
  FileText,
} from "lucide-react";

type TrialAgent = {
  id: string;
  name: string;
  description: string;
  avatar: string;
  category: string;
};

type Attachment = {
  file_id: string;
  kind: "image" | "file";
  file_name?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

type PendingAttachment = {
  // 上传未完成时 file_id 为空
  fileId: string;
  fileName: string;
  bytes: number;
  kind: "image" | "file";
  previewUrl?: string;
  uploading: boolean;
  error?: string;
};

type ChatRow = {
  id: string;
  title: string | null;
  last_active_at: string;
};

type ChatBody = {
  conversationId: string | null;
  messages: Msg[];
  loaded: boolean;
  loadingMessages: boolean;
};

type AgentState = {
  chats: ChatRow[];
  loadedChats: boolean;
  loadingChats: boolean;
  activeChatId: string | null; // null = 新建对话待发送态
  bodies: Record<string, ChatBody>;
};

const PLATFORM_NAME = "前哨智能体工作舱";

const emptyBody = (): ChatBody => ({
  conversationId: null,
  messages: [],
  loaded: false,
  loadingMessages: false,
});

const emptyAgentState = (): AgentState => ({
  chats: [],
  loadedChats: false,
  loadingChats: false,
  activeChatId: null,
  bodies: {},
});

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export default function TrialPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<TrialAgent[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("__all__");
  const [activeAgent, setActiveAgent] = useState<TrialAgent | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 拉取站点 logo（与正式版头部保持一致）
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSiteLogoUrl(d?.logo_url ?? ""))
      .catch(() => {});
  }, []);

  // ── 当前激活 agent 的状态视图（含 active chat body）
  const aState: AgentState = activeAgent
    ? agentStates[activeAgent.id] ?? emptyAgentState()
    : emptyAgentState();
  const activeBody: ChatBody = aState.activeChatId
    ? aState.bodies[aState.activeChatId] ?? emptyBody()
    : emptyBody();
  const messages = activeBody.messages;

  const updateAgentState = useCallback(
    (agentId: string, fn: (s: AgentState) => AgentState) => {
      setAgentStates((prev) => {
        const cur = prev[agentId] ?? emptyAgentState();
        return { ...prev, [agentId]: fn(cur) };
      });
    },
    []
  );

  const updateBody = useCallback(
    (agentId: string, chatId: string, fn: (b: ChatBody) => ChatBody) => {
      setAgentStates((prev) => {
        const cur = prev[agentId] ?? emptyAgentState();
        const curBody = cur.bodies[chatId] ?? emptyBody();
        return {
          ...prev,
          [agentId]: { ...cur, bodies: { ...cur.bodies, [chatId]: fn(curBody) } },
        };
      });
    },
    []
  );

  // ── 初始：加载智能体列表 ────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/trial/agents")
      .then(async (r) => {
        if (r.status === 401) {
          router.push("/login");
          return;
        }
        const d = await r.json();
        if (!r.ok) {
          setLoadErr(d.error ?? "加载失败");
          return;
        }
        const list: TrialAgent[] = d.data ?? [];
        setAgents(list);
        if (list.length === 0) setLoadErr("体验版未配置智能体，请联系管理员");
      })
      .catch(() => setLoadErr("网络错误，请刷新重试"))
      .finally(() => setLoading(false));
  }, [router]);

  // ── 自动滚到底部 ───────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeBody.loadingMessages]);

  // ── 进入某个 agent：拉聊天列表 ────────────────────────────────────
  useEffect(() => {
    if (!activeAgent) return;
    const agentId = activeAgent.id;
    const cur = agentStates[agentId];
    if (cur?.loadedChats || cur?.loadingChats) return;

    updateAgentState(agentId, (s) => ({ ...s, loadingChats: true }));

    fetch(`/api/trial/conversations?agent_id=${encodeURIComponent(agentId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("load chats failed");
        return r.json();
      })
      .then((d: { chats: ChatRow[] }) => {
        const chats = d.chats ?? [];
        updateAgentState(agentId, (s) => ({
          ...s,
          chats,
          loadedChats: true,
          loadingChats: false,
          // 自动激活最近的一条；没有则 null（新建态）
          activeChatId: chats.length > 0 ? chats[0].id : null,
        }));
      })
      .catch(() => {
        updateAgentState(agentId, (s) => ({
          ...s,
          loadedChats: true,
          loadingChats: false,
        }));
      });
  }, [activeAgent, agentStates, updateAgentState]);

  // ── 切换激活 chat：拉它的消息历史 ─────────────────────────────────
  useEffect(() => {
    if (!activeAgent) return;
    const agentId = activeAgent.id;
    const chatId = aState.activeChatId;
    if (!chatId) return;
    const body = aState.bodies[chatId];
    if (body?.loaded || body?.loadingMessages) return;

    updateBody(agentId, chatId, (b) => ({ ...b, loadingMessages: true }));

    fetch(`/api/trial/conversations/${encodeURIComponent(chatId)}/messages`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`load messages failed: ${r.status}`);
        return r.json();
      })
      .then((d: { conversation_id: string | null; messages: Msg[] }) => {
        updateBody(agentId, chatId, () => ({
          conversationId: d.conversation_id,
          messages: d.messages ?? [],
          loaded: true,
          loadingMessages: false,
        }));
      })
      .catch(() => {
        updateBody(agentId, chatId, (b) => ({
          ...b,
          loaded: true,
          loadingMessages: false,
        }));
      });
  }, [activeAgent, aState.activeChatId, aState.bodies, updateBody]);

  function clearPending() {
    setPendingAttachments((cur) => {
      cur.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return [];
    });
  }

  function enterChat(a: TrialAgent) {
    setActiveAgent(a);
    setInput("");
    clearPending();
  }

  function backToList() {
    setActiveAgent(null);
    setInput("");
    clearPending();
  }

  function newChat() {
    if (!activeAgent || streaming) return;
    updateAgentState(activeAgent.id, (s) => ({ ...s, activeChatId: null }));
    setInput("");
    clearPending();
  }

  function selectChat(chatId: string) {
    if (!activeAgent || streaming) return;
    updateAgentState(activeAgent.id, (s) => ({ ...s, activeChatId: chatId }));
    setInput("");
    clearPending();
  }

  // ── 文件上传 ──────────────────────────────────────────────────────
  async function uploadOne(file: File) {
    if (!activeAgent) return;
    const isImg = file.type.startsWith("image/");
    const previewUrl = isImg ? URL.createObjectURL(file) : undefined;
    const localKey = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`;

    setPendingAttachments((prev) => [
      ...prev,
      {
        fileId: localKey, // 临时 key；上传成功后替换为真 file_id
        fileName: file.name,
        bytes: file.size,
        kind: isImg ? "image" : "file",
        previewUrl,
        uploading: true,
      },
    ]);

    try {
      const fd = new FormData();
      fd.append("agent_id", activeAgent.id);
      fd.append("file", file);
      const res = await fetch("/api/trial/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "上传失败");

      setPendingAttachments((prev) =>
        prev.map((p) =>
          p.fileId === localKey
            ? { ...p, fileId: d.file_id, kind: d.kind, uploading: false }
            : p
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上传失败";
      setPendingAttachments((prev) =>
        prev.map((p) =>
          p.fileId === localKey ? { ...p, uploading: false, error: msg } : p
        )
      );
    }
  }

  function pickFiles() {
    if (streaming || !activeAgent) return;
    fileInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const room = 5 - pendingAttachments.length;
    if (room <= 0) {
      alert("最多 5 个附件");
      return;
    }
    files.slice(0, room).forEach(uploadOne);
  }

  function removePending(localFileId: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.fileId === localFileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.fileId !== localFileId);
    });
  }

  async function deleteChat(chatId: string) {
    if (!activeAgent || streaming) return;
    if (!confirm("确认删除这条聊天记录？")) return;
    const agentId = activeAgent.id;

    const res = await fetch(
      `/api/trial/conversations/${encodeURIComponent(chatId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      alert("删除失败，请重试");
      return;
    }

    updateAgentState(agentId, (s) => {
      const remaining = s.chats.filter((c) => c.id !== chatId);
      const newBodies = { ...s.bodies };
      delete newBodies[chatId];
      return {
        ...s,
        chats: remaining,
        bodies: newBodies,
        activeChatId:
          s.activeChatId === chatId
            ? remaining.length > 0
              ? remaining[0].id
              : null
            : s.activeChatId,
      };
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  async function send() {
    const text = input.trim();
    if (!activeAgent || streaming) return;

    // 仅取已上传成功且无错误的附件
    const usableAtts = pendingAttachments.filter(
      (p) => !p.uploading && !p.error && p.fileId
    );
    // 还有正在上传 / 出错的，提示用户
    if (pendingAttachments.some((p) => p.uploading)) {
      alert("有附件正在上传中，请稍候");
      return;
    }
    const erroredCount = pendingAttachments.filter((p) => p.error).length;
    if (erroredCount > 0) {
      const ok = confirm(`有 ${erroredCount} 个附件上传失败，将被忽略。是否继续发送？`);
      if (!ok) return;
    }

    if (!text && usableAtts.length === 0) return;

    const agentId = activeAgent.id;
    const chatIdAtSend = aState.activeChatId;

    // 优化预览：本地展示用户气泡（含附件 chip）
    const userBubble: Msg = {
      role: "user",
      content: text,
      attachments:
        usableAtts.length > 0
          ? usableAtts.map((a) => ({
              file_id: a.fileId,
              kind: a.kind,
              file_name: a.fileName,
            }))
          : undefined,
    };

    // 把用户气泡 + 占位 assistant 写到 body 里
    if (!chatIdAtSend) {
      updateBody(agentId, "__pending__", () => ({
        conversationId: null,
        messages: [userBubble, { role: "assistant", content: "" }],
        loaded: true,
        loadingMessages: false,
      }));
      updateAgentState(agentId, (s) => ({ ...s, activeChatId: "__pending__" }));
    } else {
      updateBody(agentId, chatIdAtSend, (b) => ({
        ...b,
        messages: [...b.messages, userBubble, { role: "assistant", content: "" }],
      }));
    }

    setInput("");
    clearPending();
    setStreaming(true);

    let realChatId: string | null = chatIdAtSend;

    // 把对 localKey 的写入"重定向"到实际 chat id（首次响应后）
    const writeToBody = (fn: (b: ChatBody) => ChatBody) => {
      const targetId = realChatId ?? "__pending__";
      updateBody(agentId, targetId, fn);
    };

    try {
      const res = await fetch("/api/trial/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          message: text,
          chat_id: chatIdAtSend ?? undefined,
          attachments:
            usableAtts.length > 0
              ? usableAtts.map((a) => ({ file_id: a.fileId, kind: a.kind }))
              : undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "请求失败");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const obj = JSON.parse(json);

            // meta: chat_id（新建时关键）
            if (obj.meta && typeof obj.meta.chat_id === "string") {
              const newChatId: string = obj.meta.chat_id;
              if (newChatId !== realChatId) {
                if (!realChatId && newChatId) {
                  // 把 __pending__ body 迁移到真 chat_id
                  setAgentStates((prev) => {
                    const cur = prev[agentId] ?? emptyAgentState();
                    const pendingBody = cur.bodies["__pending__"];
                    const newBodies = { ...cur.bodies };
                    if (pendingBody) {
                      newBodies[newChatId] = pendingBody;
                      delete newBodies["__pending__"];
                    }
                    // 如果 chats 列表里还没有这条，prepend 一条占位
                    let chats = cur.chats;
                    if (!chats.find((c) => c.id === newChatId)) {
                      chats = [
                        {
                          id: newChatId,
                          title: text.length > 30 ? text.slice(0, 30) + "…" : text,
                          last_active_at: new Date().toISOString(),
                        },
                        ...chats,
                      ];
                    }
                    return {
                      ...prev,
                      [agentId]: {
                        ...cur,
                        chats,
                        bodies: newBodies,
                        activeChatId: newChatId,
                      },
                    };
                  });
                }
                realChatId = newChatId;
              }
            }

            // meta: conversation_id
            if (obj.meta && typeof obj.meta.conversation_id === "string") {
              const cid: string = obj.meta.conversation_id;
              writeToBody((b) => ({ ...b, conversationId: cid }));
            }

            if (typeof obj.delta === "string") {
              writeToBody((b) => {
                const copy = [...b.messages];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = {
                  ...last,
                  content: last.content + obj.delta,
                };
                return { ...b, messages: copy };
              });
            }

            if (obj.error) {
              writeToBody((b) => {
                const copy = [...b.messages];
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: `（出错：${obj.error}）`,
                };
                return { ...b, messages: copy };
              });
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络错误，请重试";
      writeToBody((b) => {
        const copy = [...b.messages];
        copy[copy.length - 1] = { role: "assistant", content: `（${msg}）` };
        return { ...b, messages: copy };
      });
    } finally {
      setStreaming(false);
      // 把当前 chat 顶到列表第一位（last_active_at 更新）
      if (realChatId) {
        setAgentStates((prev) => {
          const cur = prev[agentId] ?? emptyAgentState();
          const idx = cur.chats.findIndex((c) => c.id === realChatId);
          if (idx < 0) return prev;
          const moved = cur.chats[idx];
          const rest = cur.chats.filter((c) => c.id !== realChatId);
          return {
            ...prev,
            [agentId]: {
              ...cur,
              chats: [
                { ...moved, last_active_at: new Date().toISOString() },
                ...rest,
              ],
            },
          };
        });
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      {/* 浅色环境光晕 */}
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#7a93ff]/30 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 -right-48 w-[640px] h-[640px] rounded-full bg-[#8da4ff]/35 blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[420px] h-[420px] rounded-full bg-[#a4b8ff]/40 blur-[140px] pointer-events-none" />

      {/* ── 顶部导航（深色保留） ─────────────────────────────── */}
      <header className="relative z-10 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 shadow-[0_4px_20px_rgba(0,47,167,0.12)]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeAgent ? (
              <button
                onClick={backToList}
                className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
              >
                <ArrowLeft size={16} /> 返回列表
              </button>
            ) : (
              <>
                <div className="w-12 h-12 rounded-[12px] overflow-hidden shrink-0 flex items-center justify-center bg-gradient-to-br from-[#002FA7] to-[#1a47c0] shadow-[0_4px_12px_rgba(0,47,167,0.25)]">
                  {siteLogoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={siteLogoUrl}
                      alt="Logo"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement
                          ?.querySelector("span")
                          ?.removeAttribute("hidden");
                      }}
                    />
                  ) : null}
                  <span hidden={!!siteLogoUrl} className="text-white text-sm font-bold">
                    AI
                  </span>
                </div>
                <p className="text-[18px] font-bold text-white leading-tight tracking-tight">
                  {PLATFORM_NAME}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[#002FA7] bg-white px-2.5 py-1 rounded-[8px] shadow-[0_2px_6px_rgba(0,0,0,0.15)]">
              体验版
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors px-3 py-1.5 rounded-[10px] hover:bg-white/5"
              title="退出登录"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">退出登录</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-[1480px] mx-auto w-full px-5 sm:px-8 lg:pl-8 lg:pr-20 py-8 flex flex-col">
        {loadErr && !activeAgent && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 rounded-[12px] text-sm">
            {loadErr}
          </div>
        )}

        {/* ── 列表模式 ─────────────────────────────────────────── */}
        {!activeAgent &&
          (() => {
            const categories = Array.from(
              new Set(agents.map((a) => a.category).filter(Boolean))
            );
            const filtered =
              activeCategory === "__all__"
                ? agents
                : agents.filter((a) => a.category === activeCategory);
            const countByCat = (cat: string) =>
              agents.filter((a) => a.category === cat).length;

            return (
              <div className="flex gap-12 items-start pt-4 lg:-ml-16">
                {/* 左侧筛选栏 */}
                <aside className="hidden lg:block w-44 shrink-0 sticky top-24">
                  <nav className="flex flex-col gap-1 pt-2">
                    <button
                      onClick={() => setActiveCategory("__all__")}
                      className={`group/item flex items-center justify-between px-3 py-2.5 rounded-[10px] text-[15px] transition-all duration-150 ${
                        activeCategory === "__all__"
                          ? "text-[#002FA7] font-semibold"
                          : "text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`w-[3px] h-5 rounded-full transition-all duration-200 ${
                            activeCategory === "__all__"
                              ? "bg-[#002FA7]"
                              : "bg-transparent group-hover/item:bg-gray-300"
                          }`}
                        />
                        全部
                      </span>
                      <span className="text-[12px] text-gray-400 font-mono">
                        {agents.length}
                      </span>
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`group/item flex items-center justify-between px-3 py-2.5 rounded-[10px] text-[15px] transition-all duration-150 ${
                          activeCategory === cat
                            ? "text-[#002FA7] font-semibold"
                            : "text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        <span className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-[3px] h-5 rounded-full transition-all duration-200 shrink-0 ${
                              activeCategory === cat
                                ? "bg-[#002FA7]"
                                : "bg-transparent group-hover/item:bg-gray-300"
                            }`}
                          />
                          <span className="truncate">{cat}</span>
                        </span>
                        <span className="text-[12px] text-gray-400 font-mono shrink-0">
                          {countByCat(cat)}
                        </span>
                      </button>
                    ))}
                  </nav>
                </aside>

                {/* 主内容区 */}
                <div className="flex-1 min-w-0">
                  {/* 移动端：横向 chip 切换 */}
                  {agents.length > 0 && (
                    <div className="flex lg:hidden gap-2 mb-5 overflow-x-auto pb-1">
                      <button
                        onClick={() => setActiveCategory("__all__")}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
                          activeCategory === "__all__"
                            ? "bg-[#002FA7] text-white border-[#002FA7]"
                            : "bg-white text-gray-600 border-gray-200"
                        }`}
                      >
                        全部 ({agents.length})
                      </button>
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setActiveCategory(cat)}
                          className={`shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
                            activeCategory === cat
                              ? "bg-[#002FA7] text-white border-[#002FA7]"
                              : "bg-white text-gray-600 border-gray-200"
                          }`}
                        >
                          {cat} ({countByCat(cat)})
                        </button>
                      ))}
                    </div>
                  )}

                  {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="bg-gray-50 border border-gray-100 rounded-[20px] p-6 h-44 animate-pulse"
                        >
                          <div className="w-12 h-12 bg-gray-200 rounded-[12px] mb-4" />
                          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                          <div className="h-3 bg-gray-200 rounded w-full" />
                        </div>
                      ))}
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-16 h-16 rounded-[18px] bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                        <MessageSquare size={28} className="text-gray-300" />
                      </div>
                      <p className="text-sm font-medium text-gray-600 mb-1">
                        暂无可用智能体
                      </p>
                      <p className="text-xs text-gray-400">
                        请联系管理员配置体验版智能体
                      </p>
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-14 h-14 rounded-[16px] bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                        <MessageSquare size={22} className="text-gray-300" />
                      </div>
                      <p className="text-sm text-gray-500 mb-2">该分类下暂无智能体</p>
                      <button
                        onClick={() => setActiveCategory("__all__")}
                        className="text-xs text-[#002FA7] hover:underline"
                      >
                        查看全部
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                      {filtered.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => enterChat(a)}
                          className="group relative overflow-hidden bg-gradient-to-br from-[#001f7a] via-[#002FA7] to-[#3b5fff] rounded-[20px] p-6 transition-all duration-500 flex flex-col gap-4 cursor-pointer text-left hover:-translate-y-1 shadow-[0_4px_16px_rgba(0,47,167,0.2)] hover:shadow-[0_24px_60px_rgba(59,95,255,0.45)]"
                        >
                          {/* 多层渐变光晕：右上主光 + 左下辅光 + 顶部高光 */}
                          <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-[#6b87ff]/40 blur-[60px] pointer-events-none transition-all duration-500 group-hover:bg-[#a4b8ff]/55 group-hover:scale-110" />
                          <div className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#3b5fff]/35 blur-[70px] pointer-events-none transition-all duration-500 group-hover:bg-[#6b87ff]/45" />
                          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
                          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

                          <div className="relative">
                            <div className="w-12 h-12 rounded-[14px] flex items-center justify-center bg-white/15 border border-white/20 backdrop-blur shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                              {a.avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.avatar}
                                  alt=""
                                  className="w-full h-full object-cover rounded-[14px]"
                                />
                              ) : (
                                <Bot size={22} className="text-white" />
                              )}
                            </div>
                          </div>

                          <div className="relative flex-1 min-h-0">
                            <h3 className="text-[16px] font-semibold text-white mb-2">
                              {a.name}
                            </h3>
                            <p className="text-[13px] text-white/75 leading-relaxed line-clamp-2">
                              {a.description}
                            </p>
                          </div>

                          <div className="relative flex items-center justify-between pt-2 border-t border-white/15">
                            <span className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-full bg-white/15 text-white border border-white/20">
                              {a.category || "体验版"}
                            </span>
                            <div className="flex items-center gap-1 text-[12px] font-medium text-white group-hover:translate-x-1 transition-transform">
                              开始对话 <ChevronRight size={14} />
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        {/* ── 对话模式 ─────────────────────────────────────────── */}
        {activeAgent && (
          <div className="flex gap-5 items-stretch h-[calc(100vh-128px)]">
            {/* 左侧聊天历史栏 */}
            <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white border border-gray-200 rounded-[20px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                <button
                  onClick={newChat}
                  disabled={streaming}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-[12px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgba(0,47,167,0.25)] transition-all"
                >
                  <Plus size={15} /> 新建对话
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {aState.loadingChats ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 size={18} className="text-gray-400 animate-spin" />
                  </div>
                ) : aState.chats.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-400">
                    还没有聊天记录
                    <br />
                    点击上方开始第一段对话
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {aState.chats.map((c) => {
                      const isActive = aState.activeChatId === c.id;
                      return (
                        <div
                          key={c.id}
                          onClick={() => selectChat(c.id)}
                          className={`group/chat relative flex items-start gap-2 px-3 py-2.5 rounded-[10px] cursor-pointer transition-all ${
                            isActive
                              ? "bg-[#002FA7]/8 border border-[#002FA7]/20"
                              : "border border-transparent hover:bg-gray-50"
                          }`}
                        >
                          <MessageCircle
                            size={13}
                            className={`mt-0.5 shrink-0 ${
                              isActive ? "text-[#002FA7]" : "text-gray-400"
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-[13px] truncate ${
                                isActive
                                  ? "text-[#002FA7] font-medium"
                                  : "text-gray-700"
                              }`}
                            >
                              {c.title || "未命名对话"}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {relativeTime(c.last_active_at)}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteChat(c.id);
                            }}
                            className="opacity-0 group-hover/chat:opacity-100 transition-opacity p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-500"
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            {/* 右侧对话面板 */}
            <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-[20px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/40">
                <div className="w-11 h-11 rounded-[12px] flex items-center justify-center bg-[#002FA7]/8 border border-[#002FA7]/15">
                  {activeAgent.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeAgent.avatar}
                      alt=""
                      className="w-full h-full object-cover rounded-[12px]"
                    />
                  ) : (
                    <Bot size={20} className="text-[#002FA7]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-gray-900 leading-tight truncate">
                    {activeAgent.name}
                  </p>
                  <p className="text-[12px] text-gray-500 mt-0.5 truncate">
                    {activeAgent.description}
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3 bg-white">
                {activeBody.loadingMessages ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <Loader2 size={22} className="text-gray-400 animate-spin mb-3" />
                    <p className="text-xs text-gray-400">正在加载历史对话…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 rounded-[18px] bg-[#002FA7]/8 border border-[#002FA7]/15 flex items-center justify-center mb-4">
                      <Bot size={26} className="text-[#002FA7]" />
                    </div>
                    <p className="text-sm text-gray-700">
                      向 {activeAgent.name} 发起对话
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      支持多轮上下文，记录将自动保存
                    </p>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${
                        m.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[78%] px-4 py-2.5 text-[14px] leading-relaxed ${
                          m.role === "user"
                            ? "bg-[#002FA7] text-white rounded-[16px] rounded-tr-[4px] shadow-[0_4px_12px_rgba(0,47,167,0.25)]"
                            : "bg-gray-50 border border-gray-100 text-gray-800 rounded-[16px] rounded-tl-[4px]"
                        }`}
                      >
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {m.attachments.map((att, ai) => (
                              <div
                                key={`${att.file_id}_${ai}`}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[11px] ${
                                  m.role === "user"
                                    ? "bg-white/20 text-white"
                                    : "bg-white border border-gray-200 text-gray-600"
                                }`}
                              >
                                {att.kind === "image" ? (
                                  <ImageIcon size={11} />
                                ) : (
                                  <FileText size={11} />
                                )}
                                <span className="max-w-[140px] truncate">
                                  {att.file_name ||
                                    (att.kind === "image" ? "图片" : "文件")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap break-words">
                          {m.content ||
                            (streaming &&
                            i === messages.length - 1 &&
                            m.role === "assistant" ? (
                              <Loader2
                                size={14}
                                className="animate-spin text-gray-400"
                              />
                            ) : (
                              ""
                            ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/40">
                {/* 待发送附件 chips */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingAttachments.map((p) => (
                      <div
                        key={p.fileId}
                        className={`group/att relative flex items-center gap-2 pl-1 pr-7 py-1 rounded-[10px] border text-[12px] ${
                          p.error
                            ? "border-red-200 bg-red-50 text-red-600"
                            : "border-gray-200 bg-white text-gray-700"
                        }`}
                      >
                        {p.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.previewUrl}
                            alt=""
                            className="w-9 h-9 object-cover rounded-[6px]"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-[6px] bg-[#002FA7]/8 flex items-center justify-center">
                            <FileText size={14} className="text-[#002FA7]" />
                          </div>
                        )}
                        <div className="max-w-[140px]">
                          <p className="truncate leading-tight">{p.fileName}</p>
                          <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                            {p.uploading
                              ? "上传中…"
                              : p.error
                              ? p.error
                              : `${(p.bytes / 1024).toFixed(0)} KB`}
                          </p>
                        </div>
                        <button
                          onClick={() => removePending(p.fileId)}
                          className="absolute right-1.5 top-1.5 p-0.5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 hover:text-gray-700 transition-colors"
                          title="移除"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.md"
                    className="hidden"
                    onChange={onFilePicked}
                  />
                  <button
                    onClick={pickFiles}
                    disabled={streaming || pendingAttachments.length >= 5}
                    title="添加附件（最多 5 个，图片 ≤10MB / 文档 ≤20MB）"
                    className="h-10 w-10 shrink-0 flex items-center justify-center rounded-[12px] border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#002FA7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                    rows={2}
                    className="flex-1 resize-none border border-gray-200 rounded-[12px] px-3 py-2 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 bg-white text-gray-900 placeholder:text-gray-400"
                  />
                  <button
                    onClick={send}
                    disabled={
                      streaming ||
                      (!input.trim() &&
                        pendingAttachments.filter((p) => !p.error).length === 0)
                    }
                    className="h-10 px-5 rounded-[12px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 shadow-[0_4px_16px_rgba(0,47,167,0.25)] transition-all"
                  >
                    <Send size={14} />
                    <span className="hidden sm:inline">
                      {streaming ? "回复中…" : "发送"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
