"use client";
import { useState, useRef, useEffect, use, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

// 附件前置校验：与 /api/upload 路由白名单 + 大小限制对齐
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const DOC_EXTS = ["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "pptx"];

function friendlyError(msg: string): string {
  if (!msg) return "调用失败，请稍后重试";
  const map: [RegExp, string][] = [
    [/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/i, "网络连接失败，请稍后重试"],
    [/ENOTFOUND|DNS/i, "服务地址无法访问，请联系管理员"],
    [/timeout|timed?\s*out/i, "请求超时，请稍后重试"],
    [/401|unauthorized|token.*invalid/i, "登录已过期，请重新登录"],
    [/403|forbidden|权限/i, "没有权限执行此操作"],
    [/429|too many|rate.?limit|频率/i, "请求过于频繁，请稍后再试"],
    [/500|internal.*error/i, "服务器内部错误，请稍后重试"],
    [/502|503|504|bad gateway|service unavailable/i, "服务暂时不可用，请稍后重试"],
    [/quota|配额|次数/i, msg],
    [/过期|expired/i, msg],
  ];
  for (const [pattern, friendly] of map) {
    if (pattern.test(msg)) return friendly;
  }
  return msg;
}

type ChatMsgProps = {
  msg: { id: string; role: string; content: string; createdAt?: string; aborted?: boolean; attachedFiles?: string[]; attachedImages?: { filename: string; url: string }[] };
  streaming: boolean;
  onCopy: () => void;
  copied: boolean;
  // P1：编辑用户消息
  isEditing: boolean;
  editValue: string;
  onChangeEdit: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  canEdit: boolean;
  // P1：重新生成（仅最后一条 assistant 满足条件时为 true）
  canRegenerate: boolean;
  onRegenerate: () => void;
};

const ChatMessage = memo(function ChatMessage({
  msg,
  streaming,
  onCopy,
  copied,
  isEditing,
  editValue,
  onChangeEdit,
  onSaveEdit,
  onCancelEdit,
  onStartEdit,
  canEdit,
  canRegenerate,
  onRegenerate,
}: ChatMsgProps) {
  const isAssistant = msg.role === "assistant";
  return (
    <div className={`group/bubble flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-[#002FA7] text-white" : "bg-gray-100 text-gray-600"}`}>
        {msg.role === "user" ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className={`max-w-[75%] flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
        <div className={`rounded-[16px] px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-[#002FA7] text-white rounded-tr-[4px]" : "bg-white text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-tl-[4px]"}`}>
          {/* 用户消息：先渲染图片缩略 + 文件 chip（如果有），再渲染正文 */}
          {!isAssistant && msg.attachedImages && msg.attachedImages.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {msg.attachedImages.map((img, ii) => (
                <a
                  key={ii}
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-[10px] overflow-hidden border border-white/30"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.filename}
                    className="max-w-[220px] max-h-[200px] object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          {!isAssistant && msg.attachedFiles && msg.attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {msg.attachedFiles.map((fname, fi) => (
                <span
                  key={fi}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[8px] bg-white/20 text-white"
                  title={fname}
                >
                  <FileText size={11} />
                  <span className="max-w-[140px] truncate">{fname}</span>
                </span>
              ))}
            </div>
          )}
          {isAssistant ? (
            msg.content ? (
              <div className="trial-md break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {msg.content}
                </ReactMarkdown>
                {/* 流式末尾闪烁光标（保留原有体验） */}
                {streaming && (
                  <span className="inline-block w-[2px] h-[14px] bg-gray-500 align-middle ml-0.5 animate-pulse" />
                )}
              </div>
            ) : streaming ? (
              <span className="inline-block w-[2px] h-[14px] bg-gray-500 align-middle animate-pulse" />
            ) : null
          ) : isEditing ? (
            // P1：编辑用户消息内联 textarea
            <div className="flex flex-col gap-2 min-w-[260px]">
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => onChangeEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onCancelEdit();
                  }
                }}
                rows={Math.min(8, Math.max(2, editValue.split("\n").length))}
                className="w-full bg-white text-gray-800 rounded-[10px] px-2 py-1.5 outline-none border border-white/40 focus:border-white text-[14px] resize-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={onCancelEdit}
                  className="text-[11px] px-2 py-1 rounded-[6px] bg-white/15 hover:bg-white/25 text-white/90"
                >
                  取消
                </button>
                <button
                  onClick={onSaveEdit}
                  className="text-[11px] px-2 py-1 rounded-[6px] bg-white text-[#002FA7] hover:bg-white/90 font-medium"
                >
                  保存并重发
                </button>
              </div>
            </div>
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
          )}
          {/* 已停止徽章 — 仅在 assistant 气泡上显示（用户消息标 aborted 是为了让历史
              过滤生效，不该出现 UI 徽章） */}
          {msg.aborted && isAssistant && (
            <div className="mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
              <Square size={9} className="fill-gray-500 text-gray-500" />
              已停止
            </div>
          )}
        </div>
        {/* hover 工具栏：复制 / 时间 / 编辑 / 重新生成 */}
        {!isEditing && (msg.content || msg.aborted) && (
          <div className="opacity-0 group-hover/bubble:opacity-100 transition-opacity flex items-center gap-2 px-1">
            {isAssistant && msg.content && (
              <button
                onClick={onCopy}
                className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                title="复制"
              >
                {copied ? (
                  <>
                    <Check size={11} className="text-[#002FA7]" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy size={11} /> 复制
                  </>
                )}
              </button>
            )}
            {/* 用户消息：编辑按钮（仅有 DB id 才显示） */}
            {!isAssistant && canEdit && (
              <button
                onClick={onStartEdit}
                className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                title="编辑并重发"
              >
                <Pencil size={11} /> 编辑
              </button>
            )}
            {/* assistant：重新生成按钮（仅最后一条 + 有 id） */}
            {isAssistant && canRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-[11px] text-gray-400 hover:text-[#002FA7] flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] hover:bg-[#002FA7]/8 transition-colors"
                title="基于上一条消息重新生成"
              >
                <RotateCcw size={11} /> 重新生成
              </button>
            )}
            {msg.createdAt && <span className="text-[10px] text-gray-400">{msg.createdAt}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Send,
  Paperclip,
  Mic,
  MicOff,
  MessageSquare,
  Zap,
  X,
  Bot,
  User,
  FileText,
  Menu,
  Square,
  Copy,
  Check,
  Pencil,
  Trash2,
  Search,
  ArrowDown,
  Loader2,
  RotateCcw,
} from "lucide-react";

/** 把会话列表按时间桶分组：今天 / 昨天 / 7 天内 / 更早 */
function bucketConversationsByTime(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 3600 * 1000;
  const sevenDaysAgo = startOfToday - 7 * 24 * 3600 * 1000;
  const buckets: Record<string, Conversation[]> = {
    今天: [],
    昨天: [],
    "7 天内": [],
    更早: [],
  };
  for (const c of convs) {
    const t = new Date(c.updated_at).getTime();
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

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** 用户主动中断 → 气泡末尾显示「已停止」徽章 */
  aborted?: boolean;
  /** 用户消息附带的文件名列表（只渲染文件名 chip，不再把文件内容平铺到 content 里） */
  attachedFiles?: string[];
  /** 用户消息附带的图片（缩略图渲染） */
  attachedImages?: { filename: string; url: string }[];
  /** user 消息原始入库 content（含 [附件内容] 段）。
   *  渲染层只用 content（已 strip）；regenerate / editAndResend 必须用 rawContent
   *  以保证带原文件块重发，否则 bot 第二次回答看不到附件内容。 */
  rawContent?: string;
};

/**
 * 解析后端拼好的 user message 内容：
 *   原始格式："识别一下这个文件\n\n[附件内容]\n文件《name1》内容：\n...\n文件《name2》内容：\n..."
 *   返回：{ text: 用户输入正文, attachedFiles: 解析出来的文件名列表 }
 * 阶段一不改后端，前端做兜底解析；后续若改成结构化保存（attachments 列）再退役本函数。
 */
function parseUserContent(raw: string): {
  text: string;
  attachedFiles: string[];
  attachedImages: { filename: string; url: string }[];
} {
  const match = raw.match(/^([\s\S]*?)\n\n\[附件内容\]\n([\s\S]*)$/);
  if (!match) return { text: raw, attachedFiles: [], attachedImages: [] };
  const [, userText, fileSection] = match;
  const filenames = Array.from(fileSection.matchAll(/文件《([^》]+)》内容[：:]/g)).map(
    (m) => m[1]
  );
  // 兼容两种格式：
  //   "[图片: name, URL: url]"  或  "[图片: name，URL: url]"  （中文逗号）
  const images = Array.from(
    fileSection.matchAll(/\[图片[:：]\s*([^,，\]]+)[,，]\s*URL[:：]\s*(https?:\/\/[^\]\s]+)\]/g)
  ).map((m) => ({ filename: m[1].trim(), url: m[2].trim() }));
  return { text: userText.trim(), attachedFiles: filenames, attachedImages: images };
}

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

type AgentInfo = {
  agent_code: string;
  name: string;
  description: string;
  agent_type?: string;
  external_url?: string;
};

type UploadedFile = {
  /** 本地随机 id，用于跟踪上传中状态 */
  uploadId: string;
  filename: string;
  bytes: number;
  extractedText: string;
  /** "uploading" / "ok" / "failed"（基于 extractedText 是否非空判定） */
  status: "uploading" | "ok" | "failed";
  errorReason?: string;
  /** image 类附件走多模态 attachments 链路（adapter 转 image_url），file 类走 fileTexts 文本拼接 */
  kind?: "image" | "file";
  /** Supabase 公开 URL，仅 image 类发给后端用 */
  url?: string;
};

export default function AgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const agentCode = decodeURIComponent(rawId);
  // 4.30up 导航流：1→2→3→2→1。从工作流详情进 chat 时 URL 带 ?wf=<id>，
  // 返回时跳回 /?wf=<id> 让主页直接进入对应工作流详情视图
  const searchParams = useSearchParams();
  const fromWorkflowId = searchParams.get("wf");
  const backHref = fromWorkflowId ? `/?wf=${encodeURIComponent(fromWorkflowId)}` : "/";

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [quota, setQuota] = useState<{ left: number; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // P1: 重命名 / 删除 / 搜索
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // P1: 编辑用户消息（按 idx）
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // P1: 滚动离底显示"回到最新"
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  // P1: 拖拽上传 hover 提示
  const [dragOver, setDragOver] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 记录最近一次 handleSend 起点时间，abort 后用于定位"本轮新入库的消息"标 aborted
  const sendStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [agentsRes, convsRes, meRes] = await Promise.allSettled([
        fetch("/api/agents"),
        fetch(`/api/conversations?agentCode=${agentCode}`),
        fetch("/api/me"),
      ]);
      if (cancelled) return;

      let found: AgentInfo | null = null;
      if (agentsRes.status === "fulfilled" && agentsRes.value.ok) {
        const data = await agentsRes.value.json();
        if (cancelled) return;
        found = data.agents?.find((a: AgentInfo) => a.agent_code === agentCode) ?? null;
      }
      // /api/agents 列表里没有（未绑工作流 / 无权限规则等），回退到单查接口
      if (!found) {
        try {
          const r = await fetch(`/api/agents/${encodeURIComponent(agentCode)}`);
          if (!cancelled && r.ok) {
            found = (await r.json()) as AgentInfo;
          }
        } catch {}
      }
      if (cancelled) return;
      if (found?.agent_type === "external" && found?.external_url) {
        // 外链型智能体：自动跳转到外部链接
        setRedirecting(true);
        window.location.replace(found.external_url);
        return;
      }
      setAgent(found ?? { agent_code: agentCode, name: agentCode, description: "" });

      if (convsRes.status === "fulfilled" && convsRes.value.ok) {
        const raw = await convsRes.value.json();
        if (cancelled) return;
        setConversations(raw.data ?? raw ?? []);
      }

      if (meRes.status === "fulfilled" && meRes.value.ok) {
        const data = await meRes.value.json();
        if (cancelled) return;
        if (data.quota) {
          setQuota({ left: data.quota.left, expiresAt: data.quota.expiresAt });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [agentCode]);

  async function loadConversationMessages(convId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => {
          // 保留前端独有的 aborted 标记：以 DB 列表为准，但根据消息 id 把
          // 已存在的 aborted 状态贴回去（防止"已停止"徽章被刷掉）。
          const abortedIds = new Set(
            prev.filter((m) => m.aborted && !m.id.startsWith("tmp-") && !m.id.startsWith("ai-")).map((m) => m.id)
          );
          return data.map((m: { id: string; role: "user" | "assistant"; content: string; created_at: string; aborted?: boolean }) => {
            const parsed =
              m.role === "user"
                ? parseUserContent(m.content)
                : { text: m.content, attachedFiles: [] as string[], attachedImages: [] as { filename: string; url: string }[] };
            const hasAttach = parsed.attachedFiles.length > 0 || parsed.attachedImages.length > 0;
            return {
              id: m.id,
              role: m.role,
              content: parsed.text,
              attachedFiles: parsed.attachedFiles.length > 0 ? parsed.attachedFiles : undefined,
              attachedImages: parsed.attachedImages.length > 0 ? parsed.attachedImages : undefined,
              rawContent: m.role === "user" && hasAttach ? m.content : undefined,
              createdAt: new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
              // 优先用 DB 字段；client 端临时 aborted 标记作为回退（异步 PATCH 还没回来时）
              aborted: m.aborted || abortedIds.has(m.id) ? true : undefined,
            };
          });
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setActiveConvId(null);
    setMessages([]);
    setUploadedFiles([]);
  }

  async function selectConversation(convId: string) {
    setActiveConvId(convId);
    setSidebarOpen(false);
    await loadConversationMessages(convId);
  }

  function autoResize() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  async function handleSend(opts?: {
    text: string;
    attachedFiles?: string[];
    attachedImages?: { filename: string; url: string }[];
  }) {
    if (streaming) return;
    // ⚠ opts.text 走 regenerate / editAndResend 时可能已经含 [附件内容] 段，
    //   不能 trim()（trim 会把段尾空白吃掉，但中间的格式保留就行）；只 trim 普通输入路径
    const sentInput = opts ? opts.text : input.trim();
    if (!sentInput) return;
    setError("");

    // 仅可用（已成功上传）的文件参与上下文；未完成 / 失败的过滤掉
    const okFiles = opts ? [] : uploadedFiles.filter((f) => f.status === "ok");
    // 拆开两条路：image 走结构化 attachments（adapter 转 image_url 多模态），
    // 文档走 fileTexts 文本拼接到 message 后面
    const okDocs = okFiles.filter((f) => f.kind !== "image");
    const okImages = okFiles.filter((f) => f.kind === "image" && f.url);
    // 走 opts 时 sentInput 自身已经含 [附件内容] 段，禁止再追加 fileTexts，否则会重复拼
    const fileTexts = okDocs.map((f) => `文件《${f.filename}》内容：\n${f.extractedText}`);
    // attachments 给 adapter 拼成多模态 image_url；opts 路径走 attachedImages 重建
    const attachments = opts?.attachedImages
      ? opts.attachedImages.map((img) => ({ kind: "image" as const, url: img.url, filename: img.filename }))
      : okImages.map((f) => ({ kind: "image" as const, url: f.url!, filename: f.filename }));
    const attachedFilenames = opts?.attachedFiles ?? okDocs.map((f) => f.filename);
    const attachedImages = opts?.attachedImages ?? okImages.map((f) => ({ filename: f.filename, url: f.url! }));

    // 乐观气泡 content：opts 路径下 sentInput 含 [附件内容]，
    // 要剥离成干净文本展示（chip 单独渲染），rawContent 留住原始带 dump 版本以备再次重发
    const optimisticContent = opts ? parseUserContent(sentInput).text : sentInput;

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: optimisticContent,
      attachedFiles: attachedFilenames.length > 0 ? attachedFilenames : undefined,
      attachedImages: attachedImages.length > 0 ? attachedImages : undefined,
      rawContent: opts && (attachedFilenames.length > 0 || attachedImages.length > 0) ? sentInput : undefined,
      createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!opts) {
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setUploadedFiles([]);
    }

    setStreaming(true);
    sendStartedAtRef.current = Date.now();
    let aiContent = "";
    const aiId = `ai-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", createdAt: "" },
    ]);

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    try {
      const res = await fetch(`/api/agents/${agentCode}/chat`, {
        method: "POST",
        signal: abortCtrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: sentInput,
          conversationId: activeConvId,
          fileTexts,
          attachments,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(friendlyError(err.error ?? ""));
        setMessages((prev) => prev.filter((m) => m.id !== aiId));
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          try {
            const obj = JSON.parse(data);
            if (obj.text) {
              aiContent += obj.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiId
                    ? { ...m, content: aiContent, createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) }
                    : m
                )
              );
            }
            if (obj.done && obj.conversationId) {
              setActiveConvId(obj.conversationId);
              // Refresh conversation list
              const convsRes = await fetch(`/api/conversations?agentCode=${agentCode}`);
              if (convsRes.ok) { const raw = await convsRes.json(); setConversations(raw.data ?? raw ?? []); }
              // Update quota
              if (quota) setQuota((q) => q ? { ...q, left: q.left - 1 } : q);
              // P1: 刷消息拿 DB id（编辑/重新生成需要）
              loadConversationMessages(obj.conversationId);
            }
            if (obj.error) {
              setError(obj.error);
            }
          } catch {}
        }
      }
    } catch (e) {
      // 用户主动中断：保留已生成内容 + 打 aborted 标记，不视作错误
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      if (isAbort) {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, aborted: true } : m))
        );
        // 4.30up A 方案：延迟 800ms 拉 DB 拿本轮入库的 message id，
        // 调 PATCH /api/messages/[id] { aborted: true } 把它们标成中断态。
        // chat 路由下次拉历史时 .eq("aborted", false) 自动过滤。
        // ⚠ 这里**不**调 loadConversationMessages（会用 DB 内容覆盖客户端已经流到
        //   一半的 partial 内容）。改为按 role 倒着把 DB id 贴回乐观气泡，
        //   保留已流到的内容 + aborted 标记。
        if (activeConvId && sendStartedAtRef.current) {
          const cid = activeConvId;
          const sentAt = sendStartedAtRef.current;
          window.setTimeout(async () => {
            try {
              const r = await fetch(`/api/conversations/${cid}/messages`);
              if (!r.ok) return;
              type RawMsg = { id: string; role: string; aborted?: boolean; created_at: string };
              const list = (await r.json()) as RawMsg[];
              const targets = list.filter(
                (m) => !m.aborted && new Date(m.created_at).getTime() >= sentAt - 1000
              );
              await Promise.all(
                targets.map((m) =>
                  fetch(`/api/messages/${encodeURIComponent(m.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ aborted: true }),
                  })
                )
              );
              // 把 DB id 贴回最近 user / assistant 乐观气泡，保留内容
              const userTarget = targets.find((t) => t.role === "user");
              const asstTarget = targets.find((t) => t.role === "assistant");
              setMessages((prev) => {
                const next = [...prev];
                let userPatched = !userTarget;
                let asstPatched = !asstTarget;
                for (let i = next.length - 1; i >= 0 && (!userPatched || !asstPatched); i--) {
                  const m = next[i];
                  if (
                    !asstPatched &&
                    m.role === "assistant" &&
                    (m.id.startsWith("ai-") || m.id.startsWith("tmp-"))
                  ) {
                    next[i] = { ...m, id: asstTarget!.id, aborted: true };
                    asstPatched = true;
                    continue;
                  }
                  if (
                    !userPatched &&
                    m.role === "user" &&
                    m.id.startsWith("tmp-")
                  ) {
                    // user 标 aborted 用于历史过滤，但 UI 徽章仅 assistant 显示
                    next[i] = { ...m, id: userTarget!.id, aborted: true };
                    userPatched = true;
                  }
                }
                return next;
              });
            } catch {}
          }, 800);
        }
      } else {
        setError("网络错误，请重试");
        setMessages((prev) => prev.filter((m) => m.id !== aiId));
      }
    } finally {
      abortControllerRef.current = null;
      setStreaming(false);
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }

  async function copyMessage(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  }

  // P1 · 重命名 / 删除会话
  async function renameConv(convId: string, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) {
      setError("重命名失败");
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: trimmed } : c))
    );
    setRenamingId(null);
  }

  async function deleteConv(convId: string) {
    if (!confirm("确认删除这条聊天记录？")) return;
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError("删除失败");
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }

  // P1 · 重新生成最后一条 assistant
  async function regenerate() {
    if (streaming || messages.length < 2) return;
    const last = messages[messages.length - 1];
    const prev = messages[messages.length - 2];
    if (last.role !== "assistant" || prev.role !== "user") return;
    // 临时 id（tmp-/ai-）说明还没刷到 DB id；按钮的 disable 条件已经卡住，
    // 这里再保一道
    if (prev.id.startsWith("tmp-") || last.id.startsWith("ai-") || last.id.startsWith("tmp-")) {
      setError("消息保存中，稍候再试");
      return;
    }
    const res = await fetch(
      `/api/messages/${encodeURIComponent(prev.id)}?from=true`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setError("重新生成失败：清理旧消息失败");
      return;
    }
    // 重新生成时必须带回原文件块（否则 bot 第二次答案看不到附件）
    const text = prev.rawContent ?? prev.content;
    setMessages((m) => m.slice(0, -2));
    await handleSend({ text, attachedFiles: prev.attachedFiles, attachedImages: prev.attachedImages });
  }

  // P1 · 编辑 user 消息后重发
  async function editAndResend(idx: number, newText: string) {
    if (streaming) return;
    const target = messages[idx];
    if (!target || target.role !== "user") return;
    const trimmed = newText.trim();
    if (!trimmed) {
      setError("内容不能为空");
      return;
    }
    if (target.id.startsWith("tmp-")) {
      setError("消息保存中，稍候再试");
      return;
    }
    const res = await fetch(
      `/api/messages/${encodeURIComponent(target.id)}?from=true`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      setError("编辑失败：清理旧消息失败");
      return;
    }
    // 编辑时把新文本 + 原文件块拼回去重发，让 bot 看到附件内容
    let textToSend = trimmed;
    if (target.rawContent) {
      const m = target.rawContent.match(/^[\s\S]*?(\n\n\[附件内容\]\n[\s\S]*)$/);
      if (m) textToSend = trimmed + m[1];
    }
    setMessages((prev) => prev.slice(0, idx));
    await handleSend({
      text: textToSend,
      attachedFiles: target.attachedFiles,
      attachedImages: target.attachedImages,
    });
  }

  // P1 · 滚动检测：离底超 80px 显示"回到最新"
  useEffect(() => {
    const el = messageScrollRef.current;
    if (!el) return;
    function onScroll() {
      const node = messageScrollRef.current;
      if (!node) return;
      const dist = node.scrollHeight - node.scrollTop - node.clientHeight;
      setShowScrollBottom(dist > 80);
    }
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages.length]);

  function scrollToBottom() {
    messageScrollRef.current?.scrollTo({
      top: messageScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }

  // P1 · 搜索过滤后的会话列表
  const filteredConvs = searchInput.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchInput.trim().toLowerCase())
      )
    : conversations;
  const conversationGroups = bucketConversationsByTime(filteredConvs);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function uploadOne(file: File) {
    // 前置校验：类型 + 大小
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isImg = file.type.startsWith("image/") || IMAGE_EXTS.includes(ext);
    if (!isImg && !DOC_EXTS.includes(ext)) {
      setError(`不支持的文件类型：.${ext || "未知"}`);
      return;
    }
    const limit = isImg ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      setError(`${isImg ? "图片" : "文件"}过大，单个不超过 ${limit / 1024 / 1024}MB`);
      return;
    }

    // 立刻插入一个 uploading 占位 chip
    const uploadId = `up-${Date.now()}-${Math.random()}`;
    setUploadedFiles((prev) => [
      ...prev,
      { uploadId, filename: file.name, bytes: file.size, extractedText: "", status: "uploading" },
    ]);

    const formData = new FormData();
    formData.append("file", file);
    if (activeConvId) formData.append("conversationId", activeConvId);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        const text = data.extractedText ?? "";
        const kind: "image" | "file" = data.kind === "image" ? "image" : "file";
        // image 类走 attachments 多模态链路，无需 extractedText 也算 ok（有 url 就够）
        const ok = kind === "image" ? Boolean(data.url) : Boolean(text);
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.uploadId === uploadId
              ? {
                  ...f,
                  filename: data.filename ?? f.filename,
                  extractedText: text,
                  kind,
                  url: data.url,
                  status: ok ? "ok" : "failed",
                  errorReason: ok ? undefined : "解析失败：文件可能损坏或格式不支持",
                }
              : f
          )
        );
      } else {
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.uploadId === uploadId
              ? { ...f, status: "failed", errorReason: data.error ?? "上传失败" }
              : f
          )
        );
        setError(data.error ?? "上传失败");
      }
    } catch {
      setUploadedFiles((prev) =>
        prev.map((f) =>
          f.uploadId === uploadId ? { ...f, status: "failed", errorReason: "上传失败" } : f
        )
      );
      setError("上传失败");
    }
  }

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    arr.forEach(uploadOne);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    // ⚠ 必须先把 files 拷成数组，再清 value。
    // e.target.files 是 live FileList，置 value="" 会同步清空它，
    // 之前的写法（先存引用再清 value）会让 length 变 0 静默返回，
    // 表现就是"点回形针选了文件没反应"。
    if (!e.target.files || e.target.files.length === 0) return;
    const arr = Array.from(e.target.files);
    e.target.value = "";
    arr.forEach(uploadOne);
  }

  // P1: 拖拽上传
  // 拖拽计数器：dragenter +1 / dragleave -1，归零才隐藏遮罩。
  // 之前用 e.currentTarget === e.target 判 leave，子节点之间 leave 几乎永不命中，
  // dragOver 会卡在 true 让 z-30 遮罩永远盖在输入区上方，导致 paperclip 点不动。
  const dragDepthRef = useRef(0);

  function onDragEnter(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault(); // 必需，否则 onDrop 不触发
    }
  }
  function onDragLeave(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  // P1: 粘贴图片
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length > 0) {
      e.preventDefault();
      handleFiles(imgs);
    }
  }

  async function handleVoice() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/ogg";

      const mr = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);

        try {
          // 1. 提交任务
          const blob = new Blob(chunks, { type: mimeType });
          const formData = new FormData();
          formData.append("audio", blob, "recording");
          const submitRes = await fetch("/api/speech", { method: "POST", body: formData });
          const submitData = await submitRes.json();

          if (!submitRes.ok || !submitData.requestId) {
            setError(submitData.error ?? "提交语音任务失败");
            return;
          }

          // 2. 前端轮询结果（首次 500ms，之后每 1000ms，最多 5 分钟）
          const { requestId, audioPath } = submitData;
          const queryBase = `/api/speech?requestId=${requestId}&audioPath=${encodeURIComponent(audioPath ?? "")}`;
          for (let i = 0; i < 60; i++) {
            const delay = Math.min(500 * Math.pow(2, i), 5000);
            await new Promise((r) => setTimeout(r, delay));
            const queryRes = await fetch(queryBase);
            const queryData = await queryRes.json();

            if (queryData.done) {
              if (queryData.text) {
                setInput((prev) => prev + queryData.text);
              } else {
                setError(queryData.error ?? "未识别到内容");
              }
              return;
            }
          }
          setError("语音识别超时，请重试");
        } catch {
          setError("语音识别失败，请重试");
        } finally {
          setTranscribing(false);
        }
      };

      mr.start(250); // 每 250ms 生成一个数据块，确保 webm 格式结构完整
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) {
      if (!navigator.mediaDevices) {
        setError("语音输入需要 HTTPS，请联系管理员开启 SSL");
      } else if (e instanceof DOMException && e.name === "NotAllowedError") {
        setError("麦克风权限被拒绝，请在浏览器设置中允许访问麦克风");
      } else {
        setError("无法访问麦克风，请检查设备和权限");
      }
    }
  }

  // 加载中：显示骨架屏
  if (!agent && !redirecting) {
    return (
      <div className="h-screen flex flex-col bg-[#f8f9fc]">
        <header className="bg-white border-b border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="h-14 px-4 flex items-center gap-3">
            <Link href={backHref} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2 flex-1">
              <div className="w-8 h-8 rounded-[10px] bg-gray-100 animate-pulse" />
              <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-[16px] bg-[#002FA7]/8 flex items-center justify-center animate-pulse">
              <Bot size={28} className="text-[#002FA7]" />
            </div>
            <p className="text-sm text-gray-400">加载中…</p>
          </div>
        </div>
      </div>
    );
  }

  // 外链跳转中：展示过渡页避免空白闪烁
  if (redirecting) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#f8f9fc] gap-4">
        <div className="w-14 h-14 rounded-[16px] bg-[#002FA7]/8 flex items-center justify-center animate-pulse">
          <Bot size={28} className="text-[#002FA7]" />
        </div>
        <p className="text-sm text-gray-500">正在跳转到外部链接…</p>
        <Link href="/" className="text-xs text-[#002FA7] hover:underline">返回首页</Link>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-[#cdd9ff] via-[#dfe6ff] to-[#aebcff]">
      {/* Top bar — 与用户端 header / admin sidebar 同源深蓝渐变 */}
      <header className="bg-gradient-to-br from-[#0f1f5a] via-[#1a3590] to-[#1a47c0] border-b border-white/10 shadow-[0_4px_20px_rgba(0,47,167,0.12)] z-30">
        <div className="h-14 px-4 flex items-center gap-3">
          <Link href={backHref} className="p-1.5 rounded-[8px] hover:bg-white/10 text-white/85 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <button className="lg:hidden p-1.5 rounded-[8px] hover:bg-white/10" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={18} className="text-white/85" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-[10px] bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-white" />
            </div>
            <span className="font-semibold text-white text-sm truncate">
              {agent?.name ?? agentCode}
            </span>
          </div>
          {quota && (
            <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-[10px] bg-white/10">
              <Zap size={13} className="text-amber-300" />
              <span className="text-xs text-white/85">剩余 {quota.left} 次</span>
              <span className="hidden sm:inline text-xs text-white/55">· 至 {quota.expiresAt}</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Conversation sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">历史会话</span>
            <div className="flex items-center gap-1">
              <button onClick={newChat} className="p-1.5 rounded-[8px] hover:bg-[#002FA7] hover:text-white text-gray-500 transition-colors" title="新建对话" aria-label="新建对话">
                <Plus size={16} />
              </button>
              <button className="lg:hidden p-1.5 rounded-[8px] hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                <X size={16} className="text-gray-500" />
              </button>
            </div>
          </div>
          {/* P1：搜索框 */}
          {conversations.length > 0 && (
            <div className="px-3 pt-3 pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] bg-gray-50 border border-gray-200 focus-within:border-[#002FA7]">
                <Search size={13} className="text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="搜索聊天"
                  className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-gray-400"
                />
                {searchInput && (
                  <button onClick={() => setSearchInput("")} className="text-gray-400 hover:text-gray-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2">
            <button onClick={newChat} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors mb-1">
              <Plus size={15} /><span>新建对话</span>
            </button>
            {conversations.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6 px-2 leading-relaxed">暂无会话记录<br/>发送消息开始对话</p>
            ) : filteredConvs.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6 px-2">没有匹配的聊天</p>
            ) : conversationGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">{group.label}</p>
                {group.items.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group/conv relative w-full flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm transition-colors mb-0.5 text-left ${activeConvId === conv.id ? "bg-[#002FA7]/8 text-[#002FA7]" : "text-gray-600 hover:bg-gray-100"}`}
                  >
                    <MessageSquare size={14} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1" onClick={() => renamingId !== conv.id && selectConversation(conv.id)}>
                      {renamingId === conv.id ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              renameConv(conv.id, renameDraft);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                          onBlur={() => renameDraft.trim() && renameConv(conv.id, renameDraft)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-white border border-[#002FA7]/40 rounded-[6px] px-1.5 py-0.5 text-sm outline-none focus:border-[#002FA7]"
                        />
                      ) : (
                        <p className="truncate font-medium cursor-pointer">{conv.title}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(conv.updated_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    {/* hover 显示重命名 / 删除 */}
                    {renamingId !== conv.id && (
                      <div className="opacity-0 group-hover/conv:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(conv.id);
                            setRenameDraft(conv.title);
                          }}
                          className="p-1 rounded-[6px] hover:bg-white/80 text-gray-400 hover:text-[#002FA7]"
                          title="重命名"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteConv(conv.id);
                          }}
                          className="p-1 rounded-[6px] hover:bg-white/80 text-gray-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Chat area */}
        <div
          className="flex-1 flex flex-col min-w-0 relative"
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div ref={messageScrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-6 relative bg-[#f8f9fc]">
            {/* P1: 拖拽上传遮罩 — 仅覆盖消息滚动区，**不**遮挡下方输入区，
                避免遮罩万一卡住时挡到 paperclip */}
            {dragOver && (
              <div className="pointer-events-none absolute inset-2 z-30 rounded-[16px] border-2 border-dashed border-[#002FA7] bg-[#002FA7]/5 flex items-center justify-center">
                <div className="text-[#002FA7] font-medium text-sm">松开鼠标上传文件</div>
              </div>
            )}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                <div className="w-16 h-16 rounded-[20px] bg-[#002FA7]/8 flex items-center justify-center">
                  <Bot size={32} className="text-[#002FA7]" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">{agent?.name ?? agentCode}</h3>
                  <p className="text-sm text-gray-500 max-w-sm">{agent?.description}</p>
                </div>
                <p className="text-xs text-gray-400">发送消息开始对话</p>
              </div>
            )}

            {messages.map((msg, i) => {
              const hasDbId = !msg.id.startsWith("tmp-") && !msg.id.startsWith("ai-");
              const isLastAssistant =
                msg.role === "assistant" && i === messages.length - 1;
              const prev = i > 0 ? messages[i - 1] : null;
              const prevHasDbId =
                prev && !prev.id.startsWith("tmp-") && !prev.id.startsWith("ai-");
              return (
                <ChatMessage
                  key={msg.id}
                  msg={msg}
                  streaming={streaming && i === messages.length - 1}
                  onCopy={() => copyMessage(msg.id, msg.content)}
                  copied={copiedId === msg.id}
                  isEditing={editingMsgIdx === i}
                  editValue={editDraft}
                  onChangeEdit={setEditDraft}
                  onSaveEdit={() => {
                    const idx = editingMsgIdx;
                    setEditingMsgIdx(null);
                    if (idx !== null) editAndResend(idx, editDraft);
                  }}
                  onCancelEdit={() => setEditingMsgIdx(null)}
                  onStartEdit={() => {
                    setEditDraft(msg.content);
                    setEditingMsgIdx(i);
                  }}
                  canEdit={msg.role === "user" && hasDbId && !streaming}
                  canRegenerate={
                    isLastAssistant &&
                    hasDbId &&
                    !!prev &&
                    prev.role === "user" &&
                    !!prevHasDbId &&
                    !streaming
                  }
                  onRegenerate={regenerate}
                />
              );
            })}

            {error && (
              <div className="flex justify-center">
                <div className="bg-red-50 text-red-500 text-sm px-4 py-2 rounded-[10px]">{error}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* P1: 回到最新按钮 */}
          {showScrollBottom && messages.length > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute right-6 bottom-32 z-20 w-10 h-10 rounded-full bg-white shadow-[0_4px_16px_rgba(0,0,0,0.15)] border border-gray-200 flex items-center justify-center text-[#002FA7] hover:bg-[#002FA7] hover:text-white transition-all"
              title="回到最新"
              aria-label="回到最新"
            >
              <ArrowDown size={16} />
            </button>
          )}

          {/* Input area */}
          <div className="bg-white border-t border-gray-100 px-4 py-3">
            <div className="max-w-4xl mx-auto">
              {/* Uploaded files preview — 带上传/解析状态角标 */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {uploadedFiles.map((f) => {
                    const failed = f.status === "failed";
                    return (
                      <div
                        key={f.uploadId}
                        title={f.errorReason ?? f.filename}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs ${
                          failed
                            ? "bg-red-50 text-red-600 border border-red-200"
                            : "bg-[#f0f4ff] text-[#002FA7]"
                        }`}
                      >
                        <FileText size={12} />
                        <span className="max-w-[120px] truncate">{f.filename}</span>
                        {f.status === "uploading" ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : f.status === "ok" ? (
                          <Check size={11} className="text-emerald-600" />
                        ) : (
                          <span className="text-amber-600">⚠</span>
                        )}
                        <button
                          onClick={() =>
                            setUploadedFiles((prev) => prev.filter((p) => p.uploadId !== f.uploadId))
                          }
                          className="hover:text-red-500 ml-1"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="bg-white rounded-[16px] border border-gray-200 focus-within:border-[#002FA7] focus-within:ring-2 focus-within:ring-[#002FA7]/10 transition-all">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  placeholder={`向 ${agent?.name ?? agentCode} 发送消息…（Shift+Enter 换行，Enter 发送，可粘贴/拖拽图片）`}
                  className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  onPaste={onPaste}
                  disabled={streaming}
                />
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                      title="上传文件"
                      aria-label="上传文件"
                    >
                      <Paperclip size={16} />
                    </button>
                    <button onClick={handleVoice} disabled={transcribing} className={`p-1.5 rounded-[8px] transition-colors ${recording ? "bg-red-100 text-red-500 hover:bg-red-200" : transcribing ? "text-yellow-500 animate-pulse cursor-not-allowed" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"}`} title={recording ? "停止录音" : transcribing ? "识别中…" : "语音输入"}>
                      {recording ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    {recording && <span className="text-xs text-red-500 animate-pulse">录音中…</span>}
                  </div>
                  {streaming ? (
                    <button
                      onClick={stopStreaming}
                      className="p-2 rounded-[10px] bg-gray-700 text-white hover:bg-gray-800 transition-all flex items-center gap-1.5"
                      title="停止生成"
                    >
                      <Square size={14} className="fill-white" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSend()}
                      disabled={!input.trim()}
                      className={`p-2 rounded-[10px] transition-all ${input.trim() ? "bg-[#002FA7] text-white hover:bg-[#1a47c0]" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                    >
                      <Send size={16} />
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.pptx,.csv,.txt,.md"
                onChange={handleFileUpload}
              />
              <p className="text-center text-[10px] text-gray-400 mt-2">AI 生成内容仅供参考，请注意核实重要信息</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
