"use client";
import { useState, useRef, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Send, Bot, User, MessageSquare, ExternalLink } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };
type AgentInfo = { id: string; name: string; description: string; agent_type: string; external_url?: string };

export default function UserAgentChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const platformConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch(`/api/user-agents/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setAgent(d);
        // 外链型直接跳转
        if (d.agent_type === "external" && d.external_url) {
          window.location.href = d.external_url;
        }
      })
      .catch(() => setError("加载失败"));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError("");
    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setStreaming(true);

    // 占位 assistant 消息
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/user-agents/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-20),
          clientPlatformConvId: platformConvIdRef.current,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "请求失败");
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
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.error) throw new Error(payload.error);
            if (payload.platformConvId) {
              platformConvIdRef.current = payload.platformConvId;
            }
            if (payload.text) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, content: last.content + payload.text }];
              });
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
              throw e;
            }
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "发生错误");
      setMessages((prev) => prev.slice(0, -1)); // 移除空 assistant 消息
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (error && !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fc]">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Link href="/" className="text-[#002FA7] text-sm hover:underline">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fc]">
      {/* 顶栏 */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" className="p-2 rounded-[10px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-8 h-8 rounded-[10px] bg-[#002FA7]/8 flex items-center justify-center shrink-0">
            <MessageSquare size={16} className="text-[#002FA7]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{agent?.name ?? "加载中…"}</p>
            {agent?.description && (
              <p className="text-xs text-gray-400 truncate">{agent.description}</p>
            )}
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0f4ff] text-[#002FA7] font-medium shrink-0">我的智能体</span>
        </div>
      </header>

      {/* 消息区 */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
            <div className="w-14 h-14 rounded-[16px] bg-[#002FA7]/8 flex items-center justify-center mb-4">
              <MessageSquare size={24} className="text-[#002FA7]" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">{agent?.name ?? ""}</p>
            <p className="text-xs text-gray-400">发送消息开始对话</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-[#002FA7]/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={15} className="text-[#002FA7]" />
              </div>
            )}
            <div className={`max-w-[75%] rounded-[16px] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-[#002FA7] text-white rounded-br-[4px]"
                : "bg-white text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.06)] rounded-bl-[4px]"
            }`}>
              {msg.content}
              {msg.role === "assistant" && msg.content === "" && streaming && (
                <span className="inline-flex gap-1 ml-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              )}
            </div>
            {msg.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <User size={15} className="text-gray-500" />
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="text-center text-xs text-red-500 py-2">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入栏 */}
      <div className="bg-white border-t border-gray-100 px-4 py-3">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            disabled={streaming}
            className="flex-1 resize-none border border-gray-200 rounded-[12px] px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all min-h-[42px] max-h-[120px] overflow-y-auto disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="w-10 h-10 rounded-[12px] bg-[#002FA7] text-white flex items-center justify-center hover:bg-[#001f7a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
