"use client";
import { useState, useRef, useEffect, use, memo, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

// Markdown fenced code 块右上角"复制"图标按钮，仅复制块内文本
function CopyableCodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = ref.current?.textContent ?? "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  }

  return (
    <div className="relative group/code my-3">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "已复制" : "复制代码块内容"}
        title={copied ? "已复制" : "复制"}
        className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-[6px] opacity-0 group-hover/code:opacity-100 focus:opacity-100 transition-opacity bg-transparent hover:bg-gray-200/80 text-gray-500 hover:text-gray-700"
      >
        {copied ? (
          <Check size={14} className="text-emerald-600" />
        ) : (
          <Copy size={14} />
        )}
      </button>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  );
}

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
  msg: { id: string; role: string; content: string; createdAt?: string; aborted?: boolean; attachedFiles?: string[]; attachedImages?: { filename: string; url: string }[]; stepReference?: string };
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
      <div className={`w-full min-w-0 flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
        {/* 气泡列 w-full 撑满整行，只作气泡 max-w 百分比的定宽参照（自身不可见）。
            气泡本身 shrink-to-fit：短消息=小气泡，长内容/代码块涨到 max-w 上限封顶。
            max-w 给在气泡上（不是列上），配合 min-w-0 让 max-w 能压过 <pre> 的
            min-content —— 这样 <pre>/表格才会在气泡内部 overflow-x 滚动而非顶出。
            assistant 上限 97%，user 上限 75% 且右对齐。 */}
        <div className={`rounded-[16px] px-4 py-3 text-sm leading-relaxed min-w-0 break-words ${isAssistant ? "max-w-[97%]" : "max-w-[75%]"} ${msg.role === "user" ? "bg-[#002FA7] text-white rounded-tr-[4px]" : "bg-white text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-tl-[4px]"}`}>
          {/* 用户消息：先渲染图片缩略 + 文件 chip（如果有），再渲染正文 */}
          {/* 5.12up · 进度条参考 chip：保留在历史消息里，让回看时知道这条带了参考 */}
          {!isAssistant && msg.stepReference && (
            <div className="mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-white/15 text-white border border-white/25">
              <Paperclip size={10} />
              参考：{msg.stepReference}
            </div>
          )}
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
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{ pre: CopyableCodeBlock }}
                >
                  {msg.content}
                </ReactMarkdown>
                {/* 流式末尾闪烁光标（保留原有体验） */}
                {streaming && (
                  <span className="inline-block w-[2px] h-[14px] bg-gray-500 align-middle ml-0.5 animate-pulse" />
                )}
              </div>
            ) : streaming ? (
              // 5.11up · 流式开始但首 token 未到时，显示 spinner 让用户知道在加载（旧版细光标容易被当成卡死）
              <span className="inline-flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={14} className="animate-spin" />
                <span>思考中…</span>
              </span>
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
import { useSearchParams, useRouter } from "next/navigation";
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
  Download,
  FileType,
} from "lucide-react";
import { exportConversation, triggerDownload } from "@/lib/export-conversation";
import type { WorkflowStep } from "@/lib/types";
import { QuotaPopover } from "@/components/quota-popover";

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
  /** 5.12up · 进度条参考的步骤标题 — 仅显示在气泡里做提示，AI prompt 走 workflowContext */
  stepReference?: string;
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
  stepReference?: string;
} {
  // 5.12up · 进度条参考标记：`[参考：xx]\n` 在 content 最前面
  let working = raw;
  let stepReference: string | undefined;
  const refMatch = working.match(/^\[参考：([^\]]+)\]\n/);
  if (refMatch) {
    stepReference = refMatch[1].trim();
    working = working.slice(refMatch[0].length);
  }

  const match = working.match(/^([\s\S]*?)\n\n\[附件内容\]\n([\s\S]*)$/);
  if (!match) return { text: working, attachedFiles: [], attachedImages: [], stepReference };
  const [, userText, fileSection] = match;
  const filenames = Array.from(fileSection.matchAll(/文件《([^》]+)》内容[：:]/g)).map(
    (m) => m[1]
  );
  // 兼容两种格式：
  //   "[图片: name, URL: url]"  或  "[图片: name，URL: url]"  （中文逗号）
  const images = Array.from(
    fileSection.matchAll(/\[图片[:：]\s*([^,，\]]+)[,，]\s*URL[:：]\s*(https?:\/\/[^\]\s]+)\]/g)
  ).map((m) => ({ filename: m[1].trim(), url: m[2].trim() }));
  return { text: userText.trim(), attachedFiles: filenames, attachedImages: images, stepReference };
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
  const router = useRouter();
  // 5.8up 工作流进度条参数
  const searchParams = useSearchParams();
  const fromWorkflowId = searchParams.get("wf");
  const stepParam = searchParams.get("step");
  const sessionId = searchParams.get("session"); // 5.9 工作流会话 ID
  const currentStepIdx = stepParam !== null ? parseInt(stepParam, 10) : 0;
  // outline=1：到达本页后自动向智能体请求本步骤产出大纲
  const outlineMode = searchParams.get("outline") === "1";
  // 5.9up 历史只读模式：从历史详情页跳来时带 readonly=1 + conv=<convId>
  const readonly = searchParams.get("readonly") === "1";
  const initialConvId = searchParams.get("conv"); // 直接定位到某条历史对话
  const backHref = readonly && sessionId
    ? `/workflows/history/${encodeURIComponent(sessionId)}`
    : fromWorkflowId
    ? `/?wf=${encodeURIComponent(fromWorkflowId)}`
    : "/";

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
  // 5.8up · 工作流步骤进度条
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([]);
  const [wfName, setWfName] = useState("");
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [showStepConfirm, setShowStepConfirm] = useState(false);
  const [pendingManualIdx, setPendingManualIdx] = useState<number | null>(null);
  const [showWorkflowComplete, setShowWorkflowComplete] = useState(false);
  // 实际当前步骤下标：优先用 agent_code 反查，URL 的 step 参数仅做兜底
  const [resolvedStepIdx, setResolvedStepIdx] = useState(currentStepIdx);
  // 跨步骤上下文：用 ref 避免触发重渲染；sent 标记保证只注入一次
  const workflowContextRef = useRef<string | null>(null);
  const workflowContextSentRef = useRef(false);
  // 5.12up · 进度条点击带的"参考"步骤标题，用于在输入框上方显示 chip
  const [stepReferenceLabel, setStepReferenceLabel] = useState<string | null>(null);
  // outline 模式：自动请求大纲，只发一次
  const outlineSentRef = useRef(false);

  // 5.6up · 多格式导出 popover + 进度
  const [exportPopoverOpen, setExportPopoverOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"markdown" | "docx" | null>(null);
  const [exportProgressText, setExportProgressText] = useState<string | null>(null);

  // 5.8up · 拉取工作流步骤列表（仅 wf 参数存在时）
  useEffect(() => {
    if (!fromWorkflowId) return;
    fetch(`/api/workflows/${encodeURIComponent(fromWorkflowId)}/steps`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setWfName(data.name ?? "");
        const steps: WorkflowStep[] = data.steps ?? [];
        setWfSteps(steps);
        // 优先信任 URL 的 step 参数（同一智能体可能出现在多个步骤）：
        // 若 URL 指向的那个步骤确实对应当前 agentCode，就直接用；
        // 否则退回 findIndex 第一个匹配；再退回 currentStepIdx 兜底
        const urlStepValid =
          currentStepIdx >= 0 &&
          currentStepIdx < steps.length &&
          steps[currentStepIdx]?.agents?.agent_code === agentCode;
        const actualIdx = steps.findIndex((s: WorkflowStep) => s.agents?.agent_code === agentCode);
        const resolved = urlStepValid ? currentStepIdx : actualIdx >= 0 ? actualIdx : currentStepIdx;
        setResolvedStepIdx(resolved);
        // 把当前步之前的所有步标记为已完成
        const done = new Set<number>();
        for (let i = 0; i < resolved; i++) done.add(i);
        setCompletedSteps(done);
      })
      .catch(() => {});
  }, [fromWorkflowId, agentCode, currentStepIdx]);

  // 5.8up · 自动查找上一个智能体步骤的最新对话，作为跨步骤上下文注入
  // 不依赖 URL from 参数，在 wfSteps 加载完成后自动执行
  // 5.9up bugfix：sessionId 变化时清空旧缓存 + 重置注入标记，避免上一个 session 的上下文残留
  useEffect(() => {
    workflowContextRef.current = null;
    workflowContextSentRef.current = false;
    if (!fromWorkflowId || !wfSteps.length || resolvedStepIdx <= 0) return;

    // 向前找最近一个 agent 类型步骤
    let prevAgentCode: string | null = null;
    for (let i = resolvedStepIdx - 1; i >= 0; i--) {
      if (wfSteps[i].exec_type === "agent" && wfSteps[i].agents?.agent_code) {
        prevAgentCode = wfSteps[i].agents!.agent_code;
        break;
      }
    }
    if (!prevAgentCode) return;

    // 拉该智能体最新的一条对话（工作流会话模式下按 sessionId 隔离）
    const ctxConvsUrl = sessionId
      ? `/api/conversations?agentCode=${encodeURIComponent(prevAgentCode)}&sessionId=${encodeURIComponent(sessionId)}&pageSize=1`
      : `/api/conversations?agentCode=${encodeURIComponent(prevAgentCode)}&pageSize=1`;
    fetch(ctxConvsUrl)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const conv = (data?.data ?? data)?.[0] ?? null;
        if (!conv?.id) return;
        return fetch(`/api/conversations/${encodeURIComponent(conv.id)}/messages`)
          .then((r) => r.ok ? r.json() : [])
          .then((msgs: { role: string; content: string }[]) => {
            if (!msgs.length) return;
            const lines: string[] = [];
            for (const m of msgs) {
              if (m.role !== "user" && m.role !== "assistant") continue;
              const cleaned = m.content.replace(/\n\n\[附件内容\][\s\S]*$/, "").trim();
              if (cleaned) lines.push(`${m.role === "user" ? "用户" : "助手"}：${cleaned}`);
            }
            let ctx = lines.join("\n\n");
            if (ctx.length > 2000) ctx = ctx.slice(0, 2000) + "…（内容过长已截断）";
            workflowContextRef.current = ctx;
          });
      })
      .catch(() => {});
  }, [fromWorkflowId, wfSteps, resolvedStepIdx, sessionId]);

  // 错误提示 3 秒后自动消失
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 3000);
    return () => clearTimeout(t);
  }, [error]);

  // 工作流步骤衔接：会话消息加载完成后，自动向智能体说明工作背景并请其继续本职工作
  // readonly 模式下不触发任何自动发送
  useEffect(() => {
    if (readonly || !outlineMode || loading || streaming || messages.length === 0 || outlineSentRef.current) return;
    outlineSentRef.current = true;
    const stepTitle = wfSteps[resolvedStepIdx]?.title;
    const contextMsg = stepTitle
      ? `你好！我们正在开展「${stepTitle}」阶段的工作。请回顾一下我们之前的对话记录，了解本阶段已完成的内容和进展，然后继续协助我完成本阶段的任务。`
      : "你好！请回顾一下我们之前的对话记录，了解当前阶段的工作进展，然后继续协助我完成本阶段的任务。";
    const t = setTimeout(() => {
      handleSend({ text: contextMsg });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineMode, loading, streaming, messages.length]);

  // popover · Esc 关闭
  useEffect(() => {
    if (!exportPopoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportPopoverOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exportPopoverOpen]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 记录最近一次 handleSend 起点时间，abort 后用于定位"本轮新入库的消息"标 aborted
  const sendStartedAtRef = useRef<number | null>(null);

  // 仅在消息条数变化时滚到底（用户发送 / 切换会话 / 重新生成）。
  // 流式中只是末尾 assistant 消息 content 变长，length 不变 → 不滚动，
  // 用户可以自由翻历史；想跟最新内容直接点右下"回到最新"。
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;
    // 5.9up bugfix：sessionId 变化（如 上一步 / 切换会话）时也必须重新加载，
    // 否则上次 session 的 activeConvId / 会话列表残留，导致看到跨 session 数据
    setActiveConvId(null);
    // 5.12up · 同步清掉进度条参考 chip
    setStepReferenceLabel(null);
    setMessages([]);

    async function load() {
      // 工作流会话模式：对话列表按 sessionId 隔离
      const convsUrl = sessionId
        ? `/api/conversations?agentCode=${agentCode}&sessionId=${encodeURIComponent(sessionId)}`
        : `/api/conversations?agentCode=${agentCode}`;
      const [agentsRes, convsRes, meRes] = await Promise.allSettled([
        fetch("/api/agents"),
        fetch(convsUrl),
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

      let convsData: Conversation[] = [];
      if (convsRes.status === "fulfilled" && convsRes.value.ok) {
        const raw = await convsRes.value.json();
        if (cancelled) return;
        convsData = raw.data ?? raw ?? [];
        setConversations(convsData);
      }

      // 5.9up readonly：URL 里带 conv=<id> 时直接打开该对话
      if (readonly && initialConvId) {
        setActiveConvId(initialConvId);
        loadConversationMessages(initialConvId);
      } else if (sessionId && convsData.length > 0) {
        // 5.9up：工作流会话模式下，每个 agent 在该 session 内只有一条对话；
        // 进入页面时自动打开它，让用户能看到上次的聊天记录
        const conv = convsData[0];
        setActiveConvId(conv.id);
        loadConversationMessages(conv.id);
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
  }, [agentCode, sessionId, readonly, initialConvId]);

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
                : { text: m.content, attachedFiles: [] as string[], attachedImages: [] as { filename: string; url: string }[], stepReference: undefined as string | undefined };
            const hasAttach = parsed.attachedFiles.length > 0 || parsed.attachedImages.length > 0;
            return {
              id: m.id,
              role: m.role,
              content: parsed.text,
              attachedFiles: parsed.attachedFiles.length > 0 ? parsed.attachedFiles : undefined,
              attachedImages: parsed.attachedImages.length > 0 ? parsed.attachedImages : undefined,
              stepReference: parsed.stepReference,
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

  // 5.6up · 对话导出（多格式 markdown / docx）
  // 调 lib/export-conversation.ts service；docx 走 dynamic import 独立 chunk
  async function doExport(format: "markdown" | "docx") {
    if (streaming || activeConvId === null) return;
    const realMsgs = messages.filter((m) => !m.id.startsWith("greeting-"));
    if (realMsgs.length === 0) return;
    if (exportingFormat) return; // 防重复

    setExportingFormat(format);
    setExportProgressText(format === "docx" ? "正在准备…" : null);
    setExportPopoverOpen(false);

    try {
      const conv = conversations.find((c) => c.id === activeConvId);
      const result = await exportConversation(
        format,
        {
          agentName: agent?.name ?? agentCode,
          agentCode,
          conversationTitle: conv?.title ?? "对话",
          messages: realMsgs.map((m) => ({
            id: m.id,
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
            createdAt: m.createdAt,
            aborted: m.aborted,
            attachedFiles: m.attachedFiles,
            attachedImages: m.attachedImages,
          })),
        },
        (stage) => setExportProgressText(stage)
      );
      triggerDownload(result.blob, result.filename);
      if (result.partialFailures.length > 0) {
        setError(
          `导出完成，但 ${result.partialFailures.length} 张图片嵌入失败已降级为链接`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? `导出失败：${e.message}` : "导出失败");
    } finally {
      setExportingFormat(null);
      setExportProgressText(null);
    }
  }

  // 进入新对话空白态时拉 bot 在平台后台配置的开场白（prologue），渲染为
  // 第一条 assistant 消息（仅前端展示，不入库、不扣配额）。
  // 用 sessionStorage 缓存 30min，避免来回切对话频繁打 Coze。
  useEffect(() => {
    if (activeConvId !== null) return;
    if (messages.length > 0) return;

    const cacheKey = `agent_greeting:${agentCode}`;
    let cancelled = false;

    (async () => {
      let prologue: string | null = null;

      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { ts: number; value: string };
          if (Date.now() - parsed.ts < 30 * 60 * 1000) prologue = parsed.value;
        }
      } catch {}

      if (!prologue) {
        try {
          const res = await fetch(
            `/api/agents/${encodeURIComponent(agentCode)}/greeting`
          );
          if (res.ok) {
            const d = (await res.json()) as { prologue: string | null };
            prologue = d.prologue;
            if (prologue) {
              try {
                sessionStorage.setItem(
                  cacheKey,
                  JSON.stringify({ ts: Date.now(), value: prologue })
                );
              } catch {}
            }
          }
        } catch {}
      }

      if (cancelled || !prologue) return;
      // 二次校验：拉的过程中用户可能已经发了消息或切换了对话
      setMessages((cur) =>
        cur.length === 0
          ? [
              {
                id: `greeting-${agentCode}`,
                role: "assistant",
                content: prologue!,
                createdAt: "",
              },
            ]
          : cur
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [agentCode, activeConvId, messages.length]);

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

    // 5.12up · 提前算 wfCtxToSend / wfRefLabelToSend 以便挂到乐观气泡上
    // （真正的 ref 标记重置在下方紧接着的代码里，保持原子性）
    const wfCtxToSend = workflowContextSentRef.current ? undefined : (workflowContextRef.current ?? undefined);
    const wfRefLabelToSend = wfCtxToSend ? (stepReferenceLabel ?? undefined) : undefined;

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: optimisticContent,
      attachedFiles: attachedFilenames.length > 0 ? attachedFilenames : undefined,
      attachedImages: attachedImages.length > 0 ? attachedImages : undefined,
      // 5.12up · 进度条参考的步骤名同步挂到乐观气泡上
      stepReference: wfRefLabelToSend,
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

    // 5.8up：首条消息带上前一步上下文，之后清零避免重复注入
    // 注：wfCtxToSend / wfRefLabelToSend 已经在 userMsg 创建那里算好，这里只做"标记已消费"
    if (wfCtxToSend) {
      workflowContextSentRef.current = true;
      // 5.12up · 进度条 chip 在发送时一次性消费完，UI 上摘掉
      setStepReferenceLabel(null);
    }

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
          workflowContext: wfCtxToSend,
          workflowReferenceLabel: wfRefLabelToSend,
          sessionId: sessionId ?? undefined,
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
              // 5.9up bugfix：必须带 sessionId 才能保持 session 隔离，
              // 否则发完消息后侧边栏会拉回所有跨 session 对话
              const refreshUrl = sessionId
                ? `/api/conversations?agentCode=${agentCode}&sessionId=${encodeURIComponent(sessionId)}`
                : `/api/conversations?agentCode=${agentCode}`;
              const convsRes = await fetch(refreshUrl);
              if (convsRes.ok) { const raw = await convsRes.json(); setConversations(raw.data ?? raw ?? []); }
              // Update quota — 5.16up W2 补丁：按本次 weight 减（加权模型如 gpt-4o 扣 5）；
              // 服务端没带 weight 时（非加权/旧逻辑）退回减 1，行为不变
              if (quota) setQuota((q) => q ? { ...q, left: q.left - (obj.weight ?? 1) } : q);
              // P1: 刷消息拿 DB id（编辑/重新生成需要）
              loadConversationMessages(obj.conversationId);
            }
            if (obj.error) {
              setError(obj.error);
              // 5.12up · 服务端发 error（含上游 AI 空响应）时清掉乐观气泡，避免留个孤零零的"思考中…"
              setMessages((prev) => prev.filter((m) => m.id !== aiId));
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

  // 5.8up · 工作流进度条辅助计算
  // 是否还有后续步骤
  const hasMoreStepsAfter = !!fromWorkflowId && wfSteps.length > resolvedStepIdx + 1;
  // 找到当前步之前最近一个 agent 类型步骤的 index（-1 = 没有 → 当前是第一步）
  const prevAgentStepIdx = fromWorkflowId
    ? (() => {
        for (let i = resolvedStepIdx - 1; i >= 0; i--) {
          if (wfSteps[i]?.exec_type === "agent" && wfSteps[i]?.agents) return i;
        }
        return -1;
      })()
    : -1;

  // 推进到 fromIdx 的下一步：遍历后续步骤，第一个 manual → 弹窗，第一个有效 agent → 跳转，走完 → 完成弹窗
  function advanceFrom(fromIdx: number) {
    if (!fromWorkflowId) return;
    let cursor = fromIdx + 1;

    // 保存进度（localStorage 乐观缓存）
    try { localStorage.setItem(`wf_progress_${fromWorkflowId}`, JSON.stringify({ unlockedUpTo: Math.min(cursor, wfSteps.length - 1) })); } catch {}
    // 保存进度到服务端（工作流会话模式）
    if (sessionId) {
      // 5.9up bugfix：keepalive 确保 PATCH 不会被紧随其后的 window.location.assign 取消
      fetch(`/api/workflow-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStepIdx: Math.min(cursor, wfSteps.length - 1) }),
        keepalive: true,
      }).catch(() => {});
    }

    // 向后找第一个需要操作的步骤
    while (cursor < wfSteps.length) {
      const step = wfSteps[cursor];
      if (step.exec_type !== "agent") {
        // 人工/外部步骤：弹窗引导
        setPendingManualIdx(cursor);
        return;
      }
      if (step.agents?.agent_code) {
        // 有效的智能体步骤：跳转（携带 session 参数保持隔离）
        const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
        const url = `/agents/${encodeURIComponent(step.agents.agent_code)}?wf=${encodeURIComponent(fromWorkflowId)}&step=${cursor}${sessionParam}`;
        window.location.assign(url);
        return;
      }
      // agent 步骤但 agents 为空（智能体已删除）：跳过继续找
      cursor++;
    }

    // 所有步骤已遍历完：标记 session 完成，显示完成弹窗
    if (sessionId) {
      fetch(`/api/workflow-sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", currentStepIdx: wfSteps.length - 1 }),
        keepalive: true,
      }).catch(() => {});
    }
    setShowWorkflowComplete(true);
  }

  function handleNextStepClick() {
    if (!hasMoreStepsAfter) {
      setShowStepConfirm(true);
      return;
    }
    const nextIdx = resolvedStepIdx + 1;
    if (wfSteps[nextIdx]?.exec_type === "agent") {
      setShowStepConfirm(true);
    } else {
      advanceFrom(resolvedStepIdx);
    }
  }

  function confirmNextStep() {
    setShowStepConfirm(false);
    if (!hasMoreStepsAfter) {
      if (fromWorkflowId) {
        try { localStorage.setItem(`wf_progress_${fromWorkflowId}`, JSON.stringify({ unlockedUpTo: wfSteps.length - 1 })); } catch {}
      }
      if (sessionId) {
        fetch(`/api/workflow-sessions/${encodeURIComponent(sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed", currentStepIdx: wfSteps.length - 1 }),
          keepalive: true,
        }).catch(() => {});
      }
      setShowWorkflowComplete(true);
      return;
    }
    // setTimeout 确保对话框关闭的状态更新先完成，再执行跳转
    setTimeout(() => advanceFrom(resolvedStepIdx), 0);
  }

  async function handleStepBarClick(idx: number) {
    if (idx === resolvedStepIdx || idx >= resolvedStepIdx) return;
    if (loading || streaming) return;
    const clickedStep = wfSteps[idx];
    if (!clickedStep?.agents?.agent_code) return;

    // 5.12up · 不再把 ctx 作为用户消息直接发送，改成挂到 workflowContextRef +
    // 显示 chip，等用户下次主动 send 时静默拼到 AI prompt（不入库不显示）
    // 旧版套娃：每次点击 → 长文本入库 → 下一步注入又包进去 → 雪球
    try {
      const convRes = await fetch(`/api/conversations?agentCode=${encodeURIComponent(clickedStep.agents.agent_code)}&pageSize=1`);
      if (!convRes.ok) return;
      const convData = await convRes.json();
      const conv = (convData?.data ?? convData)?.[0] ?? null;
      if (!conv?.id) return;

      const msgRes = await fetch(`/api/conversations/${encodeURIComponent(conv.id)}/messages`);
      if (!msgRes.ok) return;
      const msgs: { role: string; content: string }[] = await msgRes.json();

      const lines: string[] = [];
      for (const m of msgs) {
        if (m.role !== "user" && m.role !== "assistant") continue;
        const cleaned = m.content.replace(/\n\n\[附件内容\][\s\S]*$/, "").trim();
        if (cleaned) lines.push(`${m.role === "user" ? "用户" : "助手"}：${cleaned}`);
      }
      let ctx = lines.join("\n\n");
      if (!ctx) return;
      if (ctx.length > 3000) ctx = ctx.slice(0, 3000) + "…（内容过长已截断）";

      // 挂到 ref，后续主动 send 时由 handleSend 一次性消费
      workflowContextRef.current = ctx;
      workflowContextSentRef.current = false;
      setStepReferenceLabel(clickedStep.title);
    } catch {}
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
          {/* 5.6up · 导出当前对话（多格式 popover）
              disable 条件：流式中 / 无真实会话 ID / 真实消息为空 / 正在导出 */}
          {(() => {
            const realMsgCount = messages.filter(
              (m) => !m.id.startsWith("greeting-")
            ).length;
            const exportable =
              !streaming &&
              activeConvId !== null &&
              realMsgCount > 0 &&
              !exportingFormat;
            return (
              <div className="relative shrink-0">
                <button
                  onClick={() => exportable && setExportPopoverOpen((v) => !v)}
                  disabled={!exportable}
                  title={
                    streaming
                      ? "流式中无法导出，请等结束"
                      : !activeConvId
                      ? "新对话尚未保存，发送消息后可导出"
                      : exportingFormat
                      ? exportProgressText ?? "正在导出…"
                      : exportable
                      ? "导出当前对话"
                      : "无对话可导出"
                  }
                  aria-label="导出对话"
                  aria-haspopup="menu"
                  aria-expanded={exportPopoverOpen}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-[10px] text-xs font-medium text-white bg-white/15 border border-white/25 hover:bg-white/25 hover:border-white/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {exportingFormat ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  <span className="hidden sm:inline">
                    {exportingFormat
                      ? exportProgressText ?? "导出中…"
                      : "对话导出"}
                  </span>
                </button>

                {exportPopoverOpen && (
                  <>
                    {/* 点外面关闭 */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setExportPopoverOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1.5 z-50 w-[180px] max-w-[240px] bg-white rounded-[12px] border border-gray-200 shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1.5 overflow-hidden"
                    >
                      <button
                        role="menuitem"
                        onClick={() => doExport("markdown")}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Download size={14} className="text-gray-400" />
                        <span className="flex-1 text-left">Markdown</span>
                        <span className="text-[11px] text-gray-400">.md</span>
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => doExport("docx")}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <FileType size={14} className="text-gray-400" />
                        <span className="flex-1 text-left">Word</span>
                        <span className="text-[11px] text-gray-400">.docx</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {quota && (
            <QuotaPopover trigger={
              <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-[10px] bg-white/10 hover:bg-white/15 transition-colors">
                <Zap size={13} className="text-amber-300" />
                <span className="text-xs text-white/85">剩余 {quota.left} 次</span>
                <span className="hidden sm:inline text-xs text-white/55">· 至 {quota.expiresAt}</span>
              </div>
            } />
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Conversation sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">历史会话</span>
            <div className="flex items-center gap-1">
              {!readonly && (
                <button onClick={newChat} className="p-1.5 rounded-[8px] hover:bg-[#002FA7] hover:text-white text-gray-500 transition-colors" title="新建对话" aria-label="新建对话">
                  <Plus size={16} />
                </button>
              )}
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
            {!readonly && (
              <button onClick={newChat} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors mb-1">
                <Plus size={15} /><span>新建对话</span>
              </button>
            )}
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
                    {/* hover 显示重命名 / 删除（readonly 模式不显示，避免误触） */}
                    {!readonly && renamingId !== conv.id && (
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
          {/* 5.8up · 工作流水平进度条（聊天列顶部） */}
          {fromWorkflowId && wfSteps.length > 0 && (
            <div className="shrink-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3">
              {/* 左侧：上一步按钮（与右侧下一步对称） */}
              {prevAgentStepIdx >= 0 ? (
                <button
                  onClick={() => {
                    const step = wfSteps[prevAgentStepIdx];
                    if (!step?.agents) return;
                    // 5.9up：上一步不带 outline=1 —— 用户已经看过那一步的内容，
                    // 不需要再让 bot 发一遍「请回顾对话记录」的废话
                    const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
                    router.push(`/agents/${encodeURIComponent(step.agents.agent_code)}?wf=${encodeURIComponent(fromWorkflowId!)}&step=${prevAgentStepIdx}${sessionParam}`);
                  }}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[13px] font-semibold transition-all bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  ← 上一步
                </button>
              ) : (
                <div className="shrink-0 w-[88px]" />
              )}

              {/* 步骤滚动区 */}
              <div className="flex items-center flex-1 overflow-x-auto min-w-0 gap-0 pb-2 -mb-2">
                <span className="text-[11px] text-gray-400 font-medium shrink-0 mr-3 whitespace-nowrap">
                  {wfName}：
                </span>
                {wfSteps.map((step, idx) => {
                  if (idx > resolvedStepIdx) return null;
                  const isCompleted = completedSteps.has(idx);
                  const isCurrent = idx === resolvedStepIdx;
                  const isManual = step.exec_type !== "agent";
                  const isClickable = isCompleted && !!step.agents && !isManual;
                  const label = step.title;
                  return (
                    <Fragment key={step.id}>
                      {idx > 0 && (
                        <div className="w-7 h-px mx-1.5 shrink-0 bg-[#002FA7]/20" />
                      )}
                      <button
                        onClick={() => isClickable && handleStepBarClick(idx)}
                        disabled={!isClickable && !isCurrent}
                        title={
                          isManual && isCompleted ? `${label}（人工步骤，已完成）`
                          : isCompleted ? `${label}（点击将本步骤对话记录发送给当前智能体）`
                          : label
                        }
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-full shrink-0 text-[13px] font-medium transition-all ${
                          isCurrent
                            ? "bg-[#002FA7] text-white shadow-[0_2px_10px_rgba(0,47,167,0.28)]"
                            : isCompleted && isManual
                            ? "bg-amber-50 text-amber-700 border border-amber-200 cursor-default"
                            : isCompleted
                            ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 cursor-pointer"
                            : "bg-gray-100 text-gray-400 cursor-default"
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                          isCurrent ? "bg-white/20 text-white"
                          : isCompleted && isManual ? "bg-amber-200 text-amber-700"
                          : isCompleted ? "bg-green-200 text-green-700"
                          : "bg-gray-200 text-gray-400"
                        }`}>
                          {isCompleted ? "✓" : idx + 1}
                        </span>
                        <span className="whitespace-nowrap">{label}</span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>

              {/* 右侧：下一步 / 完成按钮（readonly 不显示，历史回看不能推进） */}
              {!readonly && (
                <button
                  onClick={handleNextStepClick}
                  disabled={streaming}
                  className={`shrink-0 flex items-center gap-1.5 px-5 py-2.5 rounded-full text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    !hasMoreStepsAfter
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : "bg-[#002FA7] text-white hover:bg-[#1a47c0]"
                  }`}
                >
                  {!hasMoreStepsAfter ? "完成 ✓" : "下一步 →"}
                </button>
              )}
            </div>
          )}

          <div ref={messageScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-6 relative bg-[#f8f9fc]">
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
                  canEdit={!readonly && msg.role === "user" && hasDbId && !streaming}
                  canRegenerate={
                    !readonly &&
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


          {/* 5.9up readonly：历史回看不允许发送消息，整块输入区不渲染 */}
          {readonly ? (
            <div className="bg-amber-50 border-t border-amber-200 px-4 py-3 text-center text-[12px] text-amber-700">
              只读模式 · 历史会话回看，不可发送消息或修改记录
            </div>
          ) : (
          /* Input area */
          <div className="bg-white border-t border-gray-100 px-4 py-3">
            <div className="max-w-4xl mx-auto">
              {/* 5.12up · 进度条参考 chip：点击已完成步骤后挂上，发送时一次性消费 */}
              {stepReferenceLabel && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] bg-[#002FA7]/8 text-[#002FA7] border border-[#002FA7]/15">
                  <Paperclip size={11} />
                  <span>参考：{stepReferenceLabel}</span>
                  <button
                    type="button"
                    onClick={() => {
                      workflowContextRef.current = null;
                      workflowContextSentRef.current = false;
                      setStepReferenceLabel(null);
                    }}
                    className="ml-0.5 text-[#002FA7]/60 hover:text-red-500 transition-colors"
                    title="移除参考"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
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
          )}
        </div>
      </div>

      {/* 5.8up · 工作流步骤切换确认弹窗（仅用于智能体步骤跳转 & 完成工作流） */}
      {showStepConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowStepConfirm(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl w-[440px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-900 text-lg mb-3">
              {!hasMoreStepsAfter ? "完成工作流" : "即将进入下一步"}
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-6">
              {!hasMoreStepsAfter
                ? `恭喜！您已完成「${wfName}」的所有智能体步骤。`
                : `您即将进入下一个步骤「${wfSteps[resolvedStepIdx + 1]?.title ?? ""}」，当前的对话内容将作为上下文传递过去。`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowStepConfirm(false)}
                className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmNextStep}
                className={`px-5 py-2 rounded-[10px] text-sm font-medium text-white transition-colors ${
                  !hasMoreStepsAfter ? "bg-green-500 hover:bg-green-600" : "bg-[#002FA7] hover:bg-[#1a47c0]"
                }`}
              >
                {!hasMoreStepsAfter ? "返回首页" : "继续"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 工作流完成庆祝弹窗 */}
      {showWorkflowComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[24px] p-8 shadow-2xl w-[400px] max-w-[90vw] flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-bold text-gray-900 text-[18px] mb-2">工作流已完成！</h3>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              恭喜您完成了「{wfName}」的全部流程。
            </p>
            <button
              onClick={() => router.push("/")}
              className="px-8 py-2.5 rounded-full text-sm font-semibold text-white bg-[#002FA7] hover:bg-[#1a47c0] transition-colors"
            >
              返回首页
            </button>
          </div>
        </div>
      )}

      {/* 人工步骤弹窗：逐步引导用户完成非智能体步骤 */}
      {pendingManualIdx !== null && (() => {
        const manualStep = wfSteps[pendingManualIdx];
        const typeLabel = manualStep?.exec_type === "review" ? "人工审核" : manualStep?.exec_type === "external" ? "外部工具" : "人工执行";
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white rounded-[20px] p-8 shadow-2xl w-[460px] max-w-[90vw]">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-[12px] bg-amber-100 flex items-center justify-center shrink-0">
                  <span className="text-amber-600 text-lg font-bold">!</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-[16px]">需要人工处理</h3>
                  <p className="text-xs text-gray-400 mt-0.5">第 {pendingManualIdx + 1} 步 · {typeLabel}</p>
                </div>
              </div>
              <div className="px-4 py-4 rounded-[14px] bg-amber-50 border border-amber-200 mb-5">
                <p className="text-[15px] font-semibold text-amber-800 mb-1">{manualStep?.title}</p>
                {manualStep?.description && (
                  <p className="text-[13px] text-amber-700 leading-relaxed">{manualStep.description}</p>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-6">
                请完成以上步骤后，点击「已完成，继续」推进工作流。
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingManualIdx(null)}
                  className="px-4 py-2 rounded-[10px] text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  稍后处理
                </button>
                <button
                  onClick={() => {
                    const idx = pendingManualIdx!;
                    setPendingManualIdx(null);
                    setTimeout(() => advanceFrom(idx), 0);
                  }}
                  className="px-5 py-2 rounded-[10px] text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors"
                >
                  已完成，继续
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
