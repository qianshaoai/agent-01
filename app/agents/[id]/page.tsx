"use client";
import { useState, useRef, useEffect, use, memo } from "react";

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type ChatMsgProps = {
  msg: { id: string; role: string; content: string; createdAt?: string };
  streaming: boolean;
};

const ChatMessage = memo(function ChatMessage({ msg, streaming }: ChatMsgProps) {
  return (
    <div className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === "user" ? "bg-[#002FA7] text-white" : "bg-gray-100 text-gray-600"}`}>
        {msg.role === "user" ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className={`max-w-[75%] flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}>
        <div className={`rounded-[16px] px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-[#002FA7] text-white rounded-tr-[4px]" : "bg-white text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-tl-[4px]"}`}>
          {msg.role === "assistant" ? (
            <div className="chat-content" dangerouslySetInnerHTML={{ __html: escapeHtml(msg.content).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") || (streaming ? '<span class="animate-pulse">▌</span>' : "") }} />
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
          )}
        </div>
        {msg.createdAt && <span className="text-[10px] text-gray-400 px-1">{msg.createdAt}</span>}
      </div>
    </div>
  );
});

import Link from "next/link";
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
} from "lucide-react";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

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
  filename: string;
  extractedText: string;
};

export default function AgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const agentCode = decodeURIComponent(rawId);

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

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

      if (agentsRes.status === "fulfilled" && agentsRes.value.ok) {
        const data = await agentsRes.value.json();
        if (cancelled) return;
        const found = data.agents?.find((a: AgentInfo) => a.agent_code === agentCode);
        if (found?.agent_type === "external" && found?.external_url) {
          // 外链型智能体：自动跳转到外部链接
          setRedirecting(true);
          window.location.replace(found.external_url);
          return;
        }
        setAgent(found ?? { agent_code: agentCode, name: agentCode, description: "" });
      } else {
        setAgent({ agent_code: agentCode, name: agentCode, description: "" });
      }

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
        setMessages(
          data.map((m: { id: string; role: "user" | "assistant"; content: string; created_at: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
          }))
        );
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

  async function handleSend() {
    if (!input.trim() || streaming) return;
    setError("");

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    const sentInput = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const fileTexts = uploadedFiles.map((f) => `文件《${f.filename}》内容：\n${f.extractedText}`);
    setUploadedFiles([]);

    setStreaming(true);
    let aiContent = "";
    const aiId = `ai-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", createdAt: "" },
    ]);

    try {
      const res = await fetch(`/api/agents/${agentCode}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: sentInput,
          conversationId: activeConvId,
          fileTexts,
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
            }
            if (obj.error) {
              setError(obj.error);
            }
          } catch {}
        }
      }
    } catch {
      setError("网络错误，请重试");
      setMessages((prev) => prev.filter((m) => m.id !== aiId));
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    if (activeConvId) formData.append("conversationId", activeConvId);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadedFiles((prev) => [...prev, { filename: data.filename, extractedText: data.extractedText }]);
      } else {
        setError(data.error ?? "上传失败");
      }
    } catch {
      setError("上传失败");
    }
    e.target.value = "";
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
            <Link href="/" className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
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
    <div className="h-screen flex flex-col bg-[#f8f9fc]">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)] z-30">
        <div className="h-14 px-4 flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <button className="lg:hidden p-1.5 rounded-[8px] hover:bg-gray-100" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={18} className="text-gray-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-[10px] bg-[#002FA7]/10 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-[#002FA7]" />
            </div>
            <span className="font-semibold text-gray-900 text-sm truncate">
              <span className="text-gray-400 font-mono text-xs mr-1">{agentCode}</span>
              {agent?.name ?? agentCode}
            </span>
          </div>
          {quota && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Zap size={13} className="text-amber-500" />
              <span className="text-xs text-gray-500">剩余 {quota.left} 次</span>
              <span className="hidden sm:inline text-xs text-gray-400">· 至 {quota.expiresAt}</span>
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
          <div className="flex-1 overflow-y-auto p-2">
            <button onClick={newChat} className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[10px] text-sm text-gray-500 hover:bg-gray-100 transition-colors mb-1">
              <Plus size={15} /><span>新建对话</span>
            </button>
            {conversations.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6 px-2 leading-relaxed">暂无会话记录<br/>发送消息开始对话</p>
            ) : conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-sm transition-colors mb-0.5 text-left ${activeConvId === conv.id ? "bg-[#002FA7]/8 text-[#002FA7]" : "text-gray-600 hover:bg-gray-100"}`}
              >
                <MessageSquare size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{conv.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(conv.updated_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
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

            {messages.map((msg, i) => (
              <ChatMessage key={msg.id} msg={msg} streaming={streaming && i === messages.length - 1} />
            ))}

            {error && (
              <div className="flex justify-center">
                <div className="bg-red-50 text-red-500 text-sm px-4 py-2 rounded-[10px]">{error}</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="bg-white border-t border-gray-100 px-4 py-3">
            <div className="max-w-4xl mx-auto">
              {/* Uploaded files preview */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-[#f0f4ff] px-3 py-1.5 rounded-[8px] text-xs text-[#002FA7]">
                      <FileText size={12} />
                      <span className="max-w-[120px] truncate">{f.filename}</span>
                      <button onClick={() => setUploadedFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:text-red-500 ml-1">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-[#f8f9fc] rounded-[16px] border border-gray-200 focus-within:border-[#002FA7] focus-within:ring-2 focus-within:ring-[#002FA7]/10 transition-all">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  placeholder={`向 ${agent?.name ?? agentCode} 发送消息…（Shift+Enter 换行，Enter 发送）`}
                  className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  disabled={streaming}
                />
                <div className="flex items-center justify-between px-3 pb-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors" title="上传文件" aria-label="上传文件">
                      <Paperclip size={16} />
                    </button>
                    <button onClick={handleVoice} disabled={transcribing} className={`p-1.5 rounded-[8px] transition-colors ${recording ? "bg-red-100 text-red-500 hover:bg-red-200" : transcribing ? "text-yellow-500 animate-pulse cursor-not-allowed" : "hover:bg-gray-200 text-gray-400 hover:text-gray-600"}`} title={recording ? "停止录音" : transcribing ? "识别中…" : "语音输入"}>
                      {recording ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    {recording && <span className="text-xs text-red-500 animate-pulse">录音中…</span>}
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || streaming}
                    className={`p-2 rounded-[10px] transition-all ${input.trim() && !streaming ? "bg-[#002FA7] text-white hover:bg-[#1a47c0]" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.xlsx,.csv,.jpg,.jpeg,.png,.webp" onChange={handleFileUpload} />
              <p className="text-center text-[10px] text-gray-400 mt-2">AI 生成内容仅供参考，请注意核实重要信息</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
