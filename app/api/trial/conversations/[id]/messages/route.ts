import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type CozeMsg = {
  role?: string;
  type?: string;
  content?: string;
  content_type?: string;
  created_at?: number;
};

/**
 * GET /api/trial/conversations/[id]/messages
 * 拉某条聊天记录的全量消息（从 Coze 拉）。
 * id 是 trial_conversations 表的行 id（UUID），不是 agent id。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  const userId = payload!.type === "user" ? payload!.userId : "";
  if (!userId) return NextResponse.json({ error: "无效会话" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });

  // 1) 查这条 chat 行（必须属于当前用户）
  const { data: row } = await db
    .from("trial_conversations")
    .select("agent_id, coze_conversation_id, title")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "聊天记录不存在或无权访问" }, { status: 404 });
  }

  // Phase 1：优先从本地 trial_messages 表读 —— 适用于所有平台（Coze/元器/...）
  // 也是统一入口，性能更好，不需要每次调外部 API
  type LocalMsg = {
    id: string;
    role: "user" | "assistant";
    content: string;
    attachments: { file_id: string; kind: "image" | "file"; file_name?: string }[] | null;
    created_at: string;
  };
  const { data: localMsgs } = await db
    .from("trial_messages")
    .select("id, role, content, attachments, created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });

  if (localMsgs && localMsgs.length > 0) {
    // 4.30 批次3：本地分支额外返回 id，前端用于"编辑/重新生成"
    const messages = (localMsgs as LocalMsg[]).map((m) => {
      const out: {
        id: string;
        role: string;
        content: string;
        createdAt: number | null;
        attachments?: { file_id: string; kind: "image" | "file"; file_name?: string }[];
      } = {
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at ? new Date(m.created_at).getTime() : null,
      };
      if (m.attachments && m.attachments.length > 0) {
        out.attachments = m.attachments;
      }
      return out;
    });
    return NextResponse.json({
      conversation_id: row.coze_conversation_id,
      title: row.title,
      messages,
    });
  }

  // 2) 没有本地消息 + 没有 Coze conversation_id（刚创建未发送）→ 空
  if (!row.coze_conversation_id) {
    return NextResponse.json({
      conversation_id: null,
      title: row.title,
      messages: [],
    });
  }

  // 3) 历史回退：本地空但有 Coze conversation_id（旧 chat，Phase 1 之前创建的）
  // → 从 Coze 拉一次（向后兼容）
  const agent = getTrialAgentRaw(row.agent_id);
  if (!agent || !agent.botId || !agent.apiToken) {
    return NextResponse.json(
      { error: "智能体配置缺失", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }

  let cozeData: { code?: number; data?: CozeMsg[]; msg?: string } | null = null;
  try {
    const res = await fetch(
      `https://api.coze.cn/v1/conversation/message/list?conversation_id=${encodeURIComponent(
        row.coze_conversation_id
      )}&limit=100`,
      {
        headers: { Authorization: `Bearer ${agent.apiToken}` },
      }
    );
    cozeData = await res.json().catch(() => null);
  } catch {
    return NextResponse.json(
      { error: "拉取历史失败", code: "UPSTREAM_ERROR" },
      { status: 502 }
    );
  }

  if (!cozeData || cozeData.code !== 0) {
    return NextResponse.json(
      { error: cozeData?.msg ?? "Coze 历史接口错误", code: "UPSTREAM_ERROR" },
      { status: 502 }
    );
  }

  // 4) 过滤 + 倒序变正序 + 简化字段
  type Attachment = { file_id: string; kind: "image" | "file" };
  type ParsedMsg = {
    role: "user" | "assistant";
    content: string;
    attachments?: Attachment[];
    created_at: number;
  };

  function parseObjectString(content: string): { text: string; attachments: Attachment[] } {
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr)) return { text: content, attachments: [] };
      const texts: string[] = [];
      const atts: Attachment[] = [];
      for (const part of arr) {
        if (!part || typeof part !== "object") continue;
        const t = part.type;
        if (t === "text" && typeof part.text === "string") {
          texts.push(part.text);
        } else if ((t === "image" || t === "file") && typeof part.file_id === "string") {
          atts.push({ file_id: part.file_id, kind: t });
        }
      }
      return { text: texts.join(""), attachments: atts };
    } catch {
      return { text: content, attachments: [] };
    }
  }

  const messages: Omit<ParsedMsg, "created_at">[] = (cozeData.data ?? [])
    .filter((m) => m.type === "question" || m.type === "answer")
    .map((m): ParsedMsg => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const ct = m.content_type ?? "text";
      if (ct === "object_string") {
        const { text, attachments } = parseObjectString(m.content ?? "");
        return {
          role,
          content: text,
          attachments: attachments.length > 0 ? attachments : undefined,
          created_at: m.created_at ?? 0,
        };
      }
      // text 或其他类型当纯文本处理
      return { role, content: m.content ?? "", created_at: m.created_at ?? 0 };
    })
    .filter((m) => m.content || (m.attachments && m.attachments.length > 0))
    .sort((a, b) => a.created_at - b.created_at)
    .map(({ role, content, attachments, created_at }) => ({
      role,
      content,
      // Coze created_at 是 unix 秒；前端按毫秒处理
      createdAt: created_at ? created_at * 1000 : null,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }));

  return NextResponse.json({
    conversation_id: row.coze_conversation_id,
    title: row.title,
    messages,
  });
}
