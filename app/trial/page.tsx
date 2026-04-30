"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
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
  Square,
  Copy,
  Check,
  Menu,
  Pencil,
} from "lucide-react";

type TrialAgent = {
  id: string;
  name: string;
  description: string;
  avatar: string;
  category: string;
};

type Attachment = {
  kind: "image" | "file";
  file_name?: string;
  /** Supabase Storage 公开 URL — 通用 */
  url?: string;
  /** Coze 私有 file_id — 仅 Coze 平台 */
  cozeFileId?: string;
  /** @deprecated 旧字段，保留向后兼容（旧消息从 DB 拉回时可能仍是这个字段名）*/
  file_id?: string;
  /** 仅本地刚上传时有 — ObjectURL 用于过渡显示，session 内有效 */
  previewUrl?: string;
  /** 4.30 批次1：file 类附件解析状态。pending=待后端提取；ok=已解析；failed=解析失败 */
  extractStatus?: "pending" | "ok" | "failed";
  /** 解析失败原因（与 extractStatus=failed 配套显示） */
  extractReason?: string;
};

type Msg = {
  /** 4.30 批次3：DB 消息 id。本地刚发的乐观气泡无 id，流式结束后 GET messages 刷新拿到。仅本地 trial_messages 分支有；Coze 回退分支无 */
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  /** ISO 时间或时间戳；本地刚发的消息用 Date.now()；从后端拉的历史消息用 Coze 返回的 created_at */
  createdAt?: string | number;
  /** 用户主动中断时标记，气泡末尾显示「已停止」徽章 */
  aborted?: boolean;
  /** 4.30 批次1：assistant 占位泡 → 显示"附件解析中…"。收到第一段 delta 或 attachment_status 帧后清除 */
  extractPlaceholder?: boolean;
};

// 4.30 批次1：附件大小/类型前置校验，与 app/api/trial/upload/route.ts 保持一致
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const DOC_EXTS = ["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "pptx"];

type PendingAttachment = {
  // 本地临时 ID（uploadId）— 区分不同附件 chip
  uploadId: string;
  fileName: string;
  bytes: number;
  kind: "image" | "file";
  previewUrl?: string; // 本地 ObjectURL，仅本 session 内有效
  uploading: boolean;
  error?: string;
  // 上传成功后填充：
  url?: string; // Supabase Storage 公开 URL（所有平台都能用）
  cozeFileId?: string; // Coze 私有 file_id（仅 Coze 平台时填）
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

function relativeTime(iso: string | number): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

/** 把聊天列表按时间桶分组：今天 / 昨天 / 7 天内 / 更早 */
function bucketChatsByTime(chats: ChatRow[]): { label: string; items: ChatRow[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;
  const sevenDaysAgo = startOfToday - 7 * 24 * 3600 * 1000;
  const buckets: Record<string, ChatRow[]> = { 今天: [], 昨天: [], "7 天内": [], 更早: [] };
  for (const c of chats) {
    const t = new Date(c.last_active_at).getTime();
    if (t >= startOfToday) buckets["今天"].push(c);
    else if (t >= startOfYesterday) buckets["昨天"].push(c);
    else if (t >= sevenDaysAgo) buckets["7 天内"].push(c);
    else buckets["更早"].push(c);
  }
  return [
    { label: "今天", items: buckets["今天"] },
    { label: "昨天", items: buckets["昨天"] },
    { label: "7 天内", items: buckets["7 天内"] },
    { label: "更早", items: buckets["更早"] },
  ].filter((g) => g.items.length > 0);
}

/** 通用建议提问 chip（每个智能体共用）*/
const SUGGESTIONS = [
  "介绍一下你能帮我做什么",
  "用更通俗的语言解释一下",
  "请用 markdown 格式回复",
  "给我一个具体例子",
];

export default function TrialPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<TrialAgent[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("__all__");
  const [activeAgent, setActiveAgent] = useState<TrialAgent | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [input, setInput] = useState("");
  // 复制气泡内容的反馈：刚复制过的 message index → 显示对勾 1.5s
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // 移动端聊天历史抽屉
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  // 4.30 批次2：重命名中的 chat id（同时只允许改一行）+ 草稿
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // 4.30 批次3：正在编辑的 user 消息 idx（按当前 body.messages 索引）+ 草稿
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // 4.30 批次4：拖拽态 / 聊天搜索 / 离底距离
  const [dragOver, setDragOver] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [nearBottom, setNearBottom] = useState(true);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  async function copyMessage(idx: number, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1500);
    } catch {
      // 静默失败，浏览器太老
    }
  }
  const [streaming, setStreaming] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [siteLogoUrl, setSiteLogoUrl] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 流式中断
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // 4.30 批次4：监听消息容器滚动，决定是否显示"回到最新"按钮
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setNearBottom(dist < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeAgent, aState.activeChatId]);

  // ── textarea auto-resize ────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, 200); // max 200px 后开滚
    ta.style.height = next + "px";
  }, [input]);

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
          // 4.29up：进入智能体默认新建会话，历史会话在左栏列出按需点击进入
          activeChatId: null,
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
    // 注意：不 revoke previewUrl —— 消息气泡里仍引用着这个 URL 显示缩略图
    // 否则缩略图会立即失效。session 内 ObjectURL 内存占用很小，可接受
    setPendingAttachments(() => []);
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
    setMobileDrawerOpen(false);
  }

  function selectChat(chatId: string) {
    if (!activeAgent || streaming) return;
    updateAgentState(activeAgent.id, (s) => ({ ...s, activeChatId: chatId }));
    setInput("");
    clearPending();
    setMobileDrawerOpen(false);
  }

  // ── 文件上传 ──────────────────────────────────────────────────────
  async function uploadOne(file: File) {
    if (!activeAgent) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isImg = file.type.startsWith("image/") || IMAGE_EXTS.includes(ext);
    // A6 前置校验：类型 + 大小，超限直接拦截不发请求
    if (!isImg && !DOC_EXTS.includes(ext)) {
      alert(`不支持的文件类型：.${ext || "未知"}`);
      return;
    }
    const limit = isImg ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      alert(`${isImg ? "图片" : "文件"}过大，单个不超过 ${limit / 1024 / 1024}MB`);
      return;
    }
    const previewUrl = isImg ? URL.createObjectURL(file) : undefined;
    const localKey = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`;

    setPendingAttachments((prev) => [
      ...prev,
      {
        uploadId: localKey,
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
          p.uploadId === localKey
            ? {
                ...p,
                kind: d.kind,
                uploading: false,
                url: d.url,
                cozeFileId: d.cozeFileId,
              }
            : p
        )
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "上传失败";
      setPendingAttachments((prev) =>
        prev.map((p) =>
          p.uploadId === localKey ? { ...p, uploading: false, error: msg } : p
        )
      );
    }
  }

  function pickFiles() {
    if (streaming || !activeAgent) return;
    fileInputRef.current?.click();
  }

  // 4.30 批次4：点击 + 拖拽共用上传入口
  function handleFiles(files: File[]) {
    if (!activeAgent || streaming) return;
    const room = 5 - pendingAttachments.length;
    if (room <= 0) {
      alert("最多 5 个附件");
      return;
    }
    files.slice(0, room).forEach(uploadOne);
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    handleFiles(files);
  }

  function removePending(uploadId: string) {
    setPendingAttachments((prev) => {
      const target = prev.find((p) => p.uploadId === uploadId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.uploadId !== uploadId);
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
      // 4.30 批次2：删 active chat 后回到无活跃聊天，不再自动选下一条
      return {
        ...s,
        chats: remaining,
        bodies: newBodies,
        activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
      };
    });
  }

  // 4.30 批次2：聊天重命名
  async function renameChat(chatId: string, title: string) {
    if (!activeAgent) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const agentId = activeAgent.id;
    const res = await fetch(
      `/api/trial/conversations/${encodeURIComponent(chatId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      }
    );
    if (!res.ok) {
      alert("重命名失败，请重试");
      return;
    }
    updateAgentState(agentId, (s) => ({
      ...s,
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, title: trimmed } : c
      ),
    }));
  }

  async function handleLogout() {
    if (!confirm("确认退出登录？")) return;
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }

  /**
   * 4.30 批次3：流式结束（done / error / abort）后调用，重新拉 messages 拿 DB id。
   * 服务端 finally 入库后，前端用 GET 覆盖乐观气泡，让"编辑/重新生成"按钮 enable。
   * abort 路径需要给后端 finally 留点入库时间，外部调用者负责加 setTimeout。
   * 重试逻辑：如果服务端返回的消息数 < 当前乐观气泡数 - 1，说明 user 都还没入库，
   * 延迟 500ms 重试一次，最多 retriesLeft 次。
   */
  async function refreshMessages(
    agentId: string,
    chatId: string,
    retriesLeft = 2
  ) {
    try {
      const res = await fetch(
        `/api/trial/conversations/${encodeURIComponent(chatId)}/messages`
      );
      if (!res.ok) throw new Error("");
      const d = (await res.json()) as {
        conversation_id: string | null;
        messages: Msg[];
      };
      const serverMsgs = d.messages ?? [];
      setAgentStates((prev) => {
        const cs = prev[agentId];
        if (!cs) return prev;
        const curBody = cs.bodies[chatId];
        if (!curBody) return prev;
        // 期望 server 消息数 >= 乐观气泡数 - 1（assistant 可能未入库）
        const minExpected = Math.max(0, curBody.messages.length - 1);
        if (serverMsgs.length < minExpected && retriesLeft > 0) {
          window.setTimeout(
            () => refreshMessages(agentId, chatId, retriesLeft - 1),
            500
          );
          return prev;
        }
        return {
          ...prev,
          [agentId]: {
            ...cs,
            bodies: {
              ...cs.bodies,
              [chatId]: {
                ...curBody,
                messages: serverMsgs,
                conversationId: d.conversation_id ?? curBody.conversationId,
              },
            },
          },
        };
      });
    } catch {
      if (retriesLeft > 0) {
        window.setTimeout(
          () => refreshMessages(agentId, chatId, retriesLeft - 1),
          500
        );
      }
    }
  }

  /**
   * 4.30 批次3：发送一条消息。
   * 不传 opts 时走"用户输入框"链路（默认）。
   * 传 opts 时走"重新生成 / 编辑"链路：
   *   - 复用传入的 text + atts，不消费输入框 / pendingAttachments
   *   - 不会清空 input / pending
   */
  async function send(opts?: {
    text: string;
    atts: Array<{
      kind: "image" | "file";
      fileName?: string;
      url?: string;
      cozeFileId?: string;
      previewUrl?: string;
    }>;
  }) {
    if (!activeAgent || streaming) return;

    let text: string;
    let usableAtts: Array<{
      kind: "image" | "file";
      fileName?: string;
      url?: string;
      cozeFileId?: string;
      previewUrl?: string;
    }>;

    if (opts) {
      text = opts.text;
      usableAtts = opts.atts;
    } else {
      text = input.trim();
      // 仅取已上传成功且无错误的附件（必须有 url 或 cozeFileId）
      usableAtts = pendingAttachments.filter(
        (p) => !p.uploading && !p.error && (p.url || p.cozeFileId)
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
    }

    if (!text && usableAtts.length === 0) return;

    const agentId = activeAgent.id;
    const chatIdAtSend = aState.activeChatId;

    // 优化预览：本地展示用户气泡（含附件 chip）
    // A1: 任何 file 类附件都先标 pending，等 SSE meta.attachment_status 翻牌
    const hasFileAtt = usableAtts.some((a) => a.kind === "file");
    const userBubble: Msg = {
      role: "user",
      content: text,
      createdAt: Date.now(),
      attachments:
        usableAtts.length > 0
          ? usableAtts.map((a) => ({
              kind: a.kind,
              file_name: a.fileName,
              url: a.url,
              cozeFileId: a.cozeFileId,
              // 把本地 previewUrl 一并放进消息，用于上传 → 渲染期间过渡显示
              previewUrl: a.previewUrl,
              extractStatus: a.kind === "file" ? ("pending" as const) : undefined,
            }))
          : undefined,
    };
    const assistantPlaceholder: Msg = {
      role: "assistant",
      content: "",
      extractPlaceholder: hasFileAtt,
    };

    // 把用户气泡 + 占位 assistant 写到 body 里
    if (!chatIdAtSend) {
      updateBody(agentId, "__pending__", () => ({
        conversationId: null,
        messages: [userBubble, assistantPlaceholder],
        loaded: true,
        loadingMessages: false,
      }));
      updateAgentState(agentId, (s) => ({ ...s, activeChatId: "__pending__" }));
    } else {
      updateBody(agentId, chatIdAtSend, (b) => ({
        ...b,
        messages: [...b.messages, userBubble, assistantPlaceholder],
      }));
    }

    if (!opts) {
      setInput("");
      clearPending();
    }
    setStreaming(true);
    let wasAbort = false;

    // 创建 AbortController 让用户可以中断流式
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    let realChatId: string | null = chatIdAtSend;

    // 把对 localKey 的写入"重定向"到实际 chat id（首次响应后）
    const writeToBody = (fn: (b: ChatBody) => ChatBody) => {
      const targetId = realChatId ?? "__pending__";
      updateBody(agentId, targetId, fn);
    };

    try {
      const res = await fetch("/api/trial/chat", {
        method: "POST",
        signal: abortCtrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          message: text,
          chat_id: chatIdAtSend ?? undefined,
          attachments:
            usableAtts.length > 0
              ? usableAtts.map((a) => ({
                  kind: a.kind,
                  url: a.url,
                  cozeFileId: a.cozeFileId,
                  file_name: a.fileName,
                }))
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

            // 4.30 批次1: meta.attachment_status — 翻 user 气泡 chip 牌 + 清 assistant 占位
            if (obj.meta && Array.isArray(obj.meta.attachment_status)) {
              const statusList = obj.meta.attachment_status as Array<{
                file_name: string;
                ok: boolean;
                reason?: string;
              }>;
              writeToBody((b) => {
                const copy = [...b.messages];
                // 找最后一条 user 消息，更新它的 attachments 状态
                for (let j = copy.length - 1; j >= 0; j--) {
                  if (copy[j].role === "user") {
                    const userMsg = copy[j];
                    if (userMsg.attachments) {
                      const updated = userMsg.attachments.map((att) => {
                        const s = statusList.find(
                          (x) => x.file_name === att.file_name
                        );
                        if (!s) return att;
                        return {
                          ...att,
                          extractStatus: (s.ok ? "ok" : "failed") as
                            | "ok"
                            | "failed",
                          extractReason: s.reason,
                        };
                      });
                      copy[j] = { ...userMsg, attachments: updated };
                    }
                    break;
                  }
                }
                // 清 assistant 占位
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant" && last.extractPlaceholder) {
                  copy[copy.length - 1] = { ...last, extractPlaceholder: false };
                }
                return { ...b, messages: copy };
              });
            }

            if (typeof obj.delta === "string") {
              writeToBody((b) => {
                const copy = [...b.messages];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = {
                  ...last,
                  content: last.content + obj.delta,
                  // 第一段 delta 到达即清占位（即使没收到 attachment_status 帧）
                  extractPlaceholder: false,
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
      // 用户主动中断：保留已收到的部分，标记 aborted 让气泡末尾出现「已停止」徽章
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      wasAbort = isAbort;
      if (isAbort) {
        writeToBody((b) => {
          const copy = [...b.messages];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = {
            ...last,
            aborted: true,
          };
          return { ...b, messages: copy };
        });
      } else {
        const msg = e instanceof Error ? e.message : "网络错误，请重试";
        writeToBody((b) => {
          const copy = [...b.messages];
          copy[copy.length - 1] = { role: "assistant", content: `（${msg}）` };
          return { ...b, messages: copy };
        });
      }
    } finally {
      abortControllerRef.current = null;
      setStreaming(false);
      // 4.30 批次1：兜底清掉残留 pending 状态
      // 没收到 meta.attachment_status（图片 / native 平台 / 异常路径）时，
      // 不能让 chip 永远卡在"解析中"。统一在收尾时清成 undefined。
      writeToBody((b) => {
        let dirty = false;
        const copy = b.messages.map((m) => {
          let next = m;
          if (m.role === "user" && m.attachments) {
            const cleared = m.attachments.map((att) => {
              if (att.extractStatus === "pending") {
                dirty = true;
                return { ...att, extractStatus: undefined, extractReason: undefined };
              }
              return att;
            });
            if (dirty) next = { ...next, attachments: cleared };
          }
          if (m.role === "assistant" && m.extractPlaceholder) {
            dirty = true;
            next = { ...next, extractPlaceholder: false };
          }
          return next;
        });
        return dirty ? { ...b, messages: copy } : b;
      });
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
      // 4.30 批次3：拉一次 messages 让乐观气泡补上 DB id
      // - done / error：立即拉
      // - abort：延迟 500ms（给后端 finally 入库时间）
      if (realChatId) {
        const delay = wasAbort ? 500 : 0;
        const targetChatId = realChatId;
        window.setTimeout(() => refreshMessages(agentId, targetChatId), delay);
      }
    }
  }

  // 4.30 批次3：重新生成最后一条 assistant 回复
  async function regenerate() {
    if (!activeAgent || streaming) return;
    const chatId = aState.activeChatId;
    if (!chatId || chatId === "__pending__") return;
    const body = aState.bodies[chatId];
    if (!body || body.messages.length < 2) return;
    const last = body.messages[body.messages.length - 1];
    const prev = body.messages[body.messages.length - 2];
    if (last.role !== "assistant" || prev.role !== "user") return;
    if (!last.id || !prev.id) return; // 必须都有 DB id 才允许

    // 删除该 user 及之后所有（也就是 user + 那条 assistant）
    const delRes = await fetch(
      `/api/trial/messages/${encodeURIComponent(prev.id)}?from=true`,
      { method: "DELETE" }
    );
    if (!delRes.ok) {
      alert("重新生成失败：清理旧消息失败");
      return;
    }
    // 本地砍掉这两条（send 会重新乐观插入）
    updateBody(activeAgent.id, chatId, (b) => ({
      ...b,
      messages: b.messages.slice(0, -2),
    }));
    // 用 prev 的内容 + 附件重发
    await send({
      text: prev.content,
      atts:
        prev.attachments?.map((a) => ({
          kind: a.kind,
          fileName: a.file_name,
          url: a.url,
          cozeFileId: a.cozeFileId,
          previewUrl: a.previewUrl,
        })) ?? [],
    });
  }

  // 4.30 批次3：编辑某条 user 消息后重发（attachments 沿用原消息）
  async function editAndResend(msgIdx: number, newText: string) {
    if (!activeAgent || streaming) return;
    const chatId = aState.activeChatId;
    if (!chatId || chatId === "__pending__") return;
    const body = aState.bodies[chatId];
    if (!body) return;
    const target = body.messages[msgIdx];
    if (!target || target.role !== "user" || !target.id) return;
    const trimmed = newText.trim();
    if (!trimmed) {
      alert("内容不能为空");
      return;
    }

    const delRes = await fetch(
      `/api/trial/messages/${encodeURIComponent(target.id)}?from=true`,
      { method: "DELETE" }
    );
    if (!delRes.ok) {
      alert("编辑失败：清理旧消息失败");
      return;
    }
    // 本地把 msgIdx 及之后全砍掉
    updateBody(activeAgent.id, chatId, (b) => ({
      ...b,
      messages: b.messages.slice(0, msgIdx),
    }));
    await send({
      text: trimmed,
      atts:
        target.attachments?.map((a) => ({
          kind: a.kind,
          fileName: a.file_name,
          url: a.url,
          cozeFileId: a.cozeFileId,
          previewUrl: a.previewUrl,
        })) ?? [],
    });
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      {/* 浅色环境光晕 */}
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#7a93ff]/30 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 -right-48 w-[640px] h-[640px] rounded-full bg-[#8da4ff]/35 blur-[160px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[420px] h-[420px] rounded-full bg-[#a4b8ff]/40 blur-[140px] pointer-events-none" />

      {/* ── 顶部导航（深色保留） ─────────────────────────────── */}
      <header className="relative z-10 bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 shadow-[0_4px_20px_rgba(0,47,167,0.12)]">
        <div className="max-w-[1480px] mx-auto px-5 sm:px-8 lg:pl-8 lg:pr-20 h-16 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${activeAgent ? "" : "lg:-ml-[52px]"}`}>
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
              className="flex items-center gap-1.5 text-sm text-white/85 hover:text-white transition-colors px-3 py-1.5 rounded-[10px] hover:bg-white/10"
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
                          className="bg-white/40 backdrop-blur border border-white/40 rounded-[20px] p-6 h-44 overflow-hidden"
                        >
                          <div className="w-12 h-12 rounded-[14px] mb-4 trial-shimmer" />
                          <div className="h-4 rounded w-3/4 mb-2 trial-shimmer" />
                          <div className="h-3 rounded w-full trial-shimmer" />
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
            {/* 移动端遮罩 */}
            {mobileDrawerOpen && (
              <div
                className="md:hidden fixed inset-0 z-40 bg-black/40 animate-in fade-in duration-150"
                onClick={() => setMobileDrawerOpen(false)}
              />
            )}
            <aside
              className={`shrink-0 flex flex-col bg-white border border-gray-200 overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.04)]
                md:flex md:w-64 md:rounded-[20px] md:relative md:shadow-[0_2px_10px_rgba(0,0,0,0.04)]
                ${
                  mobileDrawerOpen
                    ? "fixed inset-y-0 left-0 z-50 w-[280px] rounded-none animate-in slide-in-from-left duration-200"
                    : "hidden"
                }`}
            >
              <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center gap-2">
                <button
                  onClick={newChat}
                  disabled={streaming}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-[12px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgba(0,47,167,0.25)] transition-all"
                >
                  <Plus size={15} /> 新建对话
                </button>
                {/* 移动端关闭抽屉按钮（仅小屏 + 抽屉打开时显示）*/}
                <button
                  onClick={() => setMobileDrawerOpen(false)}
                  className="md:hidden p-2 rounded-[10px] hover:bg-gray-100 text-gray-500"
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              {/* 4.30 批次4：聊天搜索框（仅有聊天时显示） */}
              {aState.chats.length > 0 && (
                <div className="px-3 pt-2 pb-1">
                  <div className="relative">
                    <input
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="搜索聊天标题…"
                      className="w-full text-[12px] bg-gray-50 border border-gray-200 rounded-[8px] px-2.5 py-1.5 outline-none focus:border-[#002FA7] focus:bg-white transition-colors text-gray-700 placeholder:text-gray-400"
                    />
                    {chatSearch && (
                      <button
                        onClick={() => setChatSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-200 text-gray-400"
                        title="清除"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
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
                ) : (() => {
                  const q = chatSearch.trim().toLowerCase();
                  const filtered = q
                    ? aState.chats.filter((c) =>
                        (c.title ?? "").toLowerCase().includes(q)
                      )
                    : aState.chats;
                  if (filtered.length === 0) {
                    return (
                      <div className="py-8 text-center text-xs text-gray-400">
                        没有匹配的聊天记录
                      </div>
                    );
                  }
                  return (
                  <div className="flex flex-col gap-3">
                    {bucketChatsByTime(filtered).map((group) => (
                      <div key={group.label}>
                        <p className="text-[10px] font-semibold text-gray-400 tracking-wider px-3 mb-1 uppercase">
                          {group.label}
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {group.items.map((c) => {
                            const isActive = aState.activeChatId === c.id;
                            const isRenaming = renamingChatId === c.id;
                            return (
                              <div
                                key={c.id}
                                onClick={() => !isRenaming && selectChat(c.id)}
                                className={`group/chat relative flex items-start gap-2 px-3 py-2.5 rounded-[10px] transition-all ${
                                  isRenaming ? "" : "cursor-pointer"
                                } ${
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
                                  {isRenaming ? (
                                    <input
                                      autoFocus
                                      value={renameDraft}
                                      maxLength={60}
                                      onChange={(e) => setRenameDraft(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          const draft = renameDraft.trim();
                                          if (draft && draft !== (c.title ?? "")) {
                                            renameChat(c.id, draft);
                                          }
                                          setRenamingChatId(null);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          setRenamingChatId(null);
                                        }
                                      }}
                                      onBlur={() => {
                                        const draft = renameDraft.trim();
                                        if (draft && draft !== (c.title ?? "")) {
                                          renameChat(c.id, draft);
                                        }
                                        setRenamingChatId(null);
                                      }}
                                      className="w-full text-[13px] bg-white border border-[#002FA7] rounded-[6px] px-1.5 py-0.5 outline-none text-gray-800"
                                    />
                                  ) : (
                                    <p
                                      className={`text-[13px] truncate ${
                                        isActive
                                          ? "text-[#002FA7] font-medium"
                                          : "text-gray-700"
                                      }`}
                                    >
                                      {c.title || "未命名对话"}
                                    </p>
                                  )}
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    {relativeTime(c.last_active_at)}
                                  </p>
                                </div>
                                {!isRenaming && (
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover/chat:opacity-100 transition-opacity">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRenameDraft(c.title ?? "");
                                        setRenamingChatId(c.id);
                                      }}
                                      className="p-1 rounded-[6px] hover:bg-gray-100 text-gray-400 hover:text-[#002FA7]"
                                      title="重命名"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteChat(c.id);
                                      }}
                                      className="p-1 rounded-[6px] hover:bg-red-50 text-gray-400 hover:text-red-500"
                                      title="删除"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  );
                })()}
              </div>
            </aside>

            {/* 右侧对话面板 */}
            <div
              className={`relative flex-1 flex flex-col bg-white border rounded-[20px] overflow-hidden shadow-[0_2px_10px_rgba(0,0,0,0.04)] ${
                dragOver ? "border-[#002FA7]" : "border-gray-200"
              }`}
              onDragEnter={(e) => {
                if (!activeAgent || streaming) return;
                if (e.dataTransfer?.types?.includes("Files")) {
                  e.preventDefault();
                  setDragOver(true);
                }
              }}
              onDragOver={(e) => {
                if (!activeAgent || streaming) return;
                if (e.dataTransfer?.types?.includes("Files")) {
                  e.preventDefault();
                  setDragOver(true);
                }
              }}
              onDragLeave={(e) => {
                // 离开整个面板时再清；子元素之间切换不清
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragOver(false);
              }}
              onDrop={(e) => {
                if (!activeAgent || streaming) return;
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer?.files ?? []);
                if (files.length > 0) handleFiles(files);
              }}
            >
              {/* 4.30 批次4：拖拽提示遮罩 */}
              {dragOver && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#002FA7]/8 backdrop-blur-[1px] pointer-events-none rounded-[20px]">
                  <div className="px-5 py-3 rounded-[14px] bg-white border-2 border-dashed border-[#002FA7] text-[#002FA7] text-[13px] font-medium shadow-lg">
                    松开鼠标上传文件
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/40">
                {/* 移动端汉堡 → 唤出聊天历史抽屉 */}
                <button
                  onClick={() => setMobileDrawerOpen(true)}
                  className="md:hidden p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors -ml-1"
                  title="历史会话"
                  aria-label="打开历史会话"
                >
                  <Menu size={18} />
                </button>
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

              <div
                ref={messagesScrollRef}
                className="relative flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3 bg-white"
              >
                {activeBody.loadingMessages ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <Loader2 size={22} className="text-gray-400 animate-spin mb-3" />
                    <p className="text-xs text-gray-400">正在加载历史对话…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-16 h-16 rounded-[18px] bg-[#002FA7]/8 border border-[#002FA7]/15 flex items-center justify-center mb-4">
                      <Bot size={26} className="text-[#002FA7]" />
                    </div>
                    <p className="text-sm text-gray-700">
                      向 {activeAgent.name} 发起对话
                    </p>
                    <p className="text-xs text-gray-400 mt-1 mb-6">
                      支持多轮上下文，记录将自动保存
                    </p>
                    {/* 建议提问 chip */}
                    <div className="flex flex-wrap justify-center gap-2 max-w-[520px]">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setInput(s);
                            // 等下一帧让 input state 落，然后聚焦输入框
                            requestAnimationFrame(() => textareaRef.current?.focus());
                          }}
                          className="text-[12px] px-3 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 hover:border-[#002FA7] hover:text-[#002FA7] hover:bg-[#002FA7]/5 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={i}
                      className={`group/bubble flex flex-col ${
                        m.role === "user" ? "items-end" : "items-start"
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
                            {m.attachments.map((att, ai) => {
                              // 图片：优先 url（持久化的，所有平台都能看），其次 previewUrl（本 session 刚上传）
                              const imgSrc =
                                att.kind === "image" ? att.url || att.previewUrl : null;
                              if (imgSrc) {
                                return (
                                  <a
                                    key={ai}
                                    href={imgSrc}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block rounded-[10px] overflow-hidden border border-white/30"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={imgSrc}
                                      alt={att.file_name ?? "图片"}
                                      className="max-w-[220px] max-h-[200px] object-cover"
                                    />
                                  </a>
                                );
                              }
                              // 文件 / 无图片源 → chip；有 url 时整 chip 包成可下载链接
                              const chipClass = `inline-flex items-center gap-1.5 px-2 py-1 rounded-[8px] text-[11px] ${
                                m.role === "user"
                                  ? "bg-white/20 text-white hover:bg-white/30"
                                  : "bg-white border border-gray-200 text-gray-600 hover:border-[#002FA7]/40"
                              }`;
                              // A2: 解析状态角标（仅 file 类）
                              const statusBadge =
                                att.kind === "file" && att.extractStatus ? (
                                  att.extractStatus === "pending" ? (
                                    <Loader2
                                      size={10}
                                      className={`animate-spin ${
                                        m.role === "user" ? "text-white/80" : "text-gray-400"
                                      }`}
                                    />
                                  ) : att.extractStatus === "ok" ? (
                                    <Check
                                      size={10}
                                      className={
                                        m.role === "user" ? "text-white" : "text-emerald-600"
                                      }
                                    />
                                  ) : (
                                    <span
                                      title={att.extractReason ?? "解析失败"}
                                      className={
                                        m.role === "user"
                                          ? "text-amber-200"
                                          : "text-amber-600"
                                      }
                                    >
                                      ⚠
                                    </span>
                                  )
                                ) : null;
                              const chipInner = (
                                <>
                                  {att.kind === "image" ? (
                                    <ImageIcon size={11} />
                                  ) : (
                                    <FileText size={11} />
                                  )}
                                  <span className="max-w-[140px] truncate">
                                    {att.file_name ||
                                      (att.kind === "image" ? "图片" : "文件")}
                                  </span>
                                  {statusBadge}
                                </>
                              );
                              if (att.url) {
                                return (
                                  <a
                                    key={ai}
                                    href={att.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={chipClass + " transition-colors"}
                                    title={att.file_name}
                                  >
                                    {chipInner}
                                  </a>
                                );
                              }
                              return (
                                <div key={ai} className={chipClass}>
                                  {chipInner}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {m.content ? (
                          m.role === "assistant" ? (
                            <div className="trial-md break-words">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeHighlight]}
                              >
                                {m.content}
                              </ReactMarkdown>
                              {/* B12: 流式中末尾闪烁光标 */}
                              {streaming && i === messages.length - 1 && (
                                <span className="inline-block w-[2px] h-[14px] bg-gray-500 align-middle ml-0.5 animate-pulse" />
                              )}
                            </div>
                          ) : editingMsgIdx === i ? (
                            // 4.30 批次3：编辑用户消息内联输入
                            <div className="flex flex-col gap-2 min-w-[260px]">
                              <textarea
                                autoFocus
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setEditingMsgIdx(null);
                                  }
                                }}
                                rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                                className="w-full bg-white text-gray-800 rounded-[10px] px-2 py-1.5 outline-none border border-white/40 focus:border-white text-[14px] resize-none"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => setEditingMsgIdx(null)}
                                  className="text-[11px] px-2 py-1 rounded-[6px] bg-white/15 hover:bg-white/25 text-white/90"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={() => {
                                    const idx = editingMsgIdx;
                                    setEditingMsgIdx(null);
                                    if (idx !== null) editAndResend(idx, editDraft);
                                  }}
                                  className="text-[11px] px-2 py-1 rounded-[6px] bg-white text-[#002FA7] hover:bg-white/90 font-medium"
                                >
                                  保存并重发
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap break-words">{m.content}</div>
                          )
                        ) : streaming &&
                          i === messages.length - 1 &&
                          m.role === "assistant" ? (
                          // A1: 占位状态 — 有附件需要解析时显示文字 + spinner，否则只显示 spinner
                          m.extractPlaceholder ? (
                            <span className="inline-flex items-center gap-1.5 text-gray-500 text-[13px] italic">
                              <Loader2 size={13} className="animate-spin" />
                              附件解析中…
                            </span>
                          ) : (
                            <Loader2 size={14} className="animate-spin text-gray-400" />
                          )
                        ) : (
                          ""
                        )}
                        {m.aborted && (
                          <div className="mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                            <Square size={9} className="fill-gray-500 text-gray-500" />
                            已停止
                          </div>
                        )}
                      </div>
                      {/* hover 工具栏：复制按钮 + 相对时间 */}
                      {m.content && (
                        <div className="opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center gap-1.5 mt-1 px-1">
                          <button
                            onClick={() => copyMessage(i, m.content)}
                            className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                            title="复制"
                          >
                            {copiedIdx === i ? (
                              <>
                                <Check size={11} className="text-[#002FA7]" /> 已复制
                              </>
                            ) : (
                              <>
                                <Copy size={11} /> 复制
                              </>
                            )}
                          </button>
                          {m.createdAt && (
                            <span
                              className="text-[10px] text-gray-400"
                              title={new Date(m.createdAt).toLocaleString("zh-CN")}
                            >
                              {relativeTime(m.createdAt)}
                            </span>
                          )}
                          {/* 4.30 批次3: 编辑用户消息（仅 user + 有 id + 非流式中） */}
                          {m.role === "user" && m.id && !streaming && (
                            <button
                              onClick={() => {
                                setEditDraft(m.content);
                                setEditingMsgIdx(i);
                              }}
                              className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                              title="编辑并重发"
                            >
                              <Pencil size={11} /> 编辑
                            </button>
                          )}
                          {/* 4.30 批次3: 重新生成（仅最后一条 assistant + 自身和上一条 user 都有 id + 非流式中） */}
                          {m.role === "assistant" &&
                            i === messages.length - 1 &&
                            m.id &&
                            messages[i - 1]?.id &&
                            messages[i - 1]?.role === "user" &&
                            !streaming && (
                              <button
                                onClick={regenerate}
                                className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                                title="基于上一条消息重新生成"
                              >
                                <Loader2 size={11} /> 重新生成
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* 4.30 批次4：回到最新按钮（离底 >80px 才显示） */}
              {!nearBottom && (
                <button
                  onClick={() =>
                    messagesEndRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "end",
                    })
                  }
                  className="absolute bottom-24 right-6 z-20 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-[0_4px_12px_rgba(0,0,0,0.08)] flex items-center justify-center text-gray-500 hover:text-[#002FA7] hover:border-[#002FA7]/40 transition-colors"
                  title="回到最新"
                  aria-label="回到最新"
                >
                  <ChevronRight size={16} className="rotate-90" />
                </button>
              )}

              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/40">
                {/* 待发送附件 chips */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingAttachments.map((p) => (
                      <div
                        key={p.uploadId}
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
                          onClick={() => removePending(p.uploadId)}
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
                    accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.pptx,.csv,.txt,.md"
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
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    onPaste={(e) => {
                      // 粘贴图片直传：拦截剪贴板里的 image item
                      if (streaming || pendingAttachments.length >= 5) return;
                      const items = Array.from(e.clipboardData?.items ?? []);
                      const images = items
                        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
                        .map((it) => it.getAsFile())
                        .filter((f): f is File => !!f);
                      if (images.length === 0) return;
                      e.preventDefault();
                      const room = 5 - pendingAttachments.length;
                      images.slice(0, room).forEach(uploadOne);
                    }}
                    placeholder="输入消息（支持 Markdown，可粘贴图片）"
                    rows={2}
                    className="flex-1 resize-none border border-gray-200 rounded-[12px] px-3 py-2 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 bg-white text-gray-900 placeholder:text-gray-400 leading-relaxed"
                  />
                  {streaming ? (
                    <button
                      onClick={stopStreaming}
                      title="停止生成"
                      className="h-10 px-5 rounded-[12px] bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 flex items-center gap-1.5 shrink-0 shadow-[0_4px_16px_rgba(31,41,55,0.25)] transition-all"
                    >
                      <Square size={12} className="fill-white" />
                      <span className="hidden sm:inline">停止</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => send()}
                      disabled={
                        !input.trim() &&
                        pendingAttachments.filter((p) => !p.error).length === 0
                      }
                      className="h-10 px-5 rounded-[12px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 shadow-[0_4px_16px_rgba(0,47,167,0.25)] transition-all"
                    >
                      <Send size={14} />
                      <span className="hidden sm:inline">发送</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
