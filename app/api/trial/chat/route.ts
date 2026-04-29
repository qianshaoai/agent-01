import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";
import { streamChat } from "@/lib/adapters";
import { db } from "@/lib/db";

const TITLE_MAX = 30;

function makeTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > TITLE_MAX ? trimmed.slice(0, TITLE_MAX) + "…" : trimmed;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  const userId = payload!.type === "user" ? payload!.userId : "";
  const userPhone = payload!.type === "user" ? payload!.phone : null;
  if (!userId) return NextResponse.json({ error: "无效会话" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agentId: string = typeof body.agent_id === "string" ? body.agent_id : "";
  const message: string = typeof body.message === "string" ? body.message : "";
  const clientChatId: string | null =
    typeof body.chat_id === "string" && body.chat_id ? body.chat_id : null;

  // 附件：[{file_id, kind:"image"|"file"}]
  type RawAttachment = { file_id?: unknown; kind?: unknown };
  const rawAttachments: RawAttachment[] = Array.isArray(body.attachments)
    ? (body.attachments as RawAttachment[])
    : [];
  const attachments = rawAttachments
    .filter((a): a is { file_id: string; kind: "image" | "file" } =>
      typeof a.file_id === "string" && (a.kind === "image" || a.kind === "file")
    )
    .slice(0, 5);

  // 附件可以替代 message（仅发图也允许）；但消息和附件不能都为空
  if (!agentId || (!message && attachments.length === 0)) {
    return NextResponse.json(
      { error: "agent_id 必填，message 或 attachments 至少其一", code: "BAD_REQUEST" },
      { status: 400 }
    );
  }

  const raw = getTrialAgentRaw(agentId);
  if (!raw) {
    return NextResponse.json(
      { error: `trial agent not found: ${agentId}`, code: "NOT_FOUND" },
      { status: 404 }
    );
  }
  if (!raw.botId || !raw.apiToken) {
    return NextResponse.json(
      { error: `trial agent ${agentId} missing botId/apiToken`, code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
  const agent = raw;

  // ── 解析或创建 chat row ────────────────────────────────────────────────
  let chatId: string;
  let cozeConvId: string | null = null;
  let isNewChat = false;

  if (clientChatId) {
    // 续聊：必须存在且属于当前用户
    const { data: row } = await db
      .from("trial_conversations")
      .select("id, agent_id, coze_conversation_id")
      .eq("id", clientChatId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        { error: "聊天记录不存在或无权访问", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    if (row.agent_id !== agentId) {
      return NextResponse.json(
        { error: "agent_id 与聊天记录不一致", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }
    chatId = row.id;
    cozeConvId = row.coze_conversation_id ?? null;
  } else {
    // 新建：插入一行，标题取首条用户消息（无文本时降级用附件提示）
    const fallbackTitle =
      attachments.length > 0
        ? attachments.some((a) => a.kind === "image")
          ? "[图片]"
          : "[文件]"
        : "新对话";
    const { data: row, error: insertErr } = await db
      .from("trial_conversations")
      .insert({
        user_id: userId,
        agent_id: agentId,
        coze_conversation_id: null,
        title: message ? makeTitle(message) : fallbackTitle,
        last_active_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr || !row) {
      return NextResponse.json(
        { error: insertErr?.message ?? "创建聊天失败", code: "INTERNAL_ERROR" },
        { status: 500 }
      );
    }
    chatId = row.id;
    isNewChat = true;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let ok = true;
      let errMsg: string | undefined;
      let finalCozeConvId: string | null = cozeConvId;

      // 首先把 chat_id 透传给前端（新建时尤其关键，前端要拿这个 id 存 activeChatId）
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ meta: { chat_id: chatId, is_new_chat: isNewChat } })}\n\n`
        )
      );

      const cfg = {
        platform: agent.platform,
        apiEndpoint: agent.apiEndpoint,
        apiKey: agent.apiToken,
        agentCode: agent.botId,
        modelParams: { bot_id: agent.botId } as Record<string, unknown>,
        platformConvId: cozeConvId,
        onPlatformConvId: (id: string) => {
          if (!id || finalCozeConvId === id) return;
          finalCozeConvId = id;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ meta: { conversation_id: id } })}\n\n`
            )
          );
        },
      };

      try {
        const userMessage = {
          role: "user" as const,
          content: message,
          attachments:
            attachments.length > 0
              ? attachments.map((a) => ({ fileId: a.file_id, kind: a.kind }))
              : undefined,
        };
        for await (const chunk of streamChat([userMessage], cfg)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`)
          );
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (e: unknown) {
        ok = false;
        errMsg = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
        );
      } finally {
        // UPDATE chat 行：刷新 last_active_at；新会话时也要写入 coze_conversation_id
        if (ok) {
          const updates: Record<string, unknown> = {
            last_active_at: new Date().toISOString(),
          };
          if (finalCozeConvId && finalCozeConvId !== cozeConvId) {
            updates.coze_conversation_id = finalCozeConvId;
          }
          const { error: updErr } = await db
            .from("trial_conversations")
            .update(updates)
            .eq("id", chatId)
            .eq("user_id", userId);
          if (updErr) {
            console.error("[trial_chat] update trial_conversations failed:", updErr);
          }
        } else if (isNewChat) {
          // 新建后流式失败，回滚：删掉这条空行，避免列表里出现一条没消息的死记录
          await db.from("trial_conversations").delete().eq("id", chatId).eq("user_id", userId);
        }

        // logs fire-and-forget
        db.from("logs")
          .insert({
            user_phone: userPhone,
            tenant_code: "PERSONAL",
            agent_code: agent.id,
            agent_name: agent.name,
            action: "trial_chat",
            status: ok ? "success" : "error",
            duration_ms: Date.now() - startedAt,
            error_msg: errMsg ?? null,
          })
          .then(
            () => {},
            () => {}
          );

        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
