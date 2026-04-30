import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";
import { streamChat, type ChatMessage } from "@/lib/adapters";
import { db } from "@/lib/db";
import { extractTextFromUrl } from "@/lib/trial-text-extract";

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

  // 附件：4.30up 通用化后字段：{ kind, url?, cozeFileId?, file_name?, file_id? (legacy) }
  // 至少要有 url 或 cozeFileId 或 file_id 之一
  type RawAttachment = {
    kind?: unknown;
    url?: unknown;
    cozeFileId?: unknown;
    file_id?: unknown;
    file_name?: unknown;
  };
  const rawAttachments: RawAttachment[] = Array.isArray(body.attachments)
    ? (body.attachments as RawAttachment[])
    : [];
  type ParsedAtt = {
    kind: "image" | "file";
    url?: string;
    cozeFileId?: string;
    file_id?: string;
    file_name?: string;
  };
  const attachments: ParsedAtt[] = rawAttachments
    .map((a): ParsedAtt | null => {
      if (a.kind !== "image" && a.kind !== "file") return null;
      const url = typeof a.url === "string" ? a.url : undefined;
      const cozeFileId = typeof a.cozeFileId === "string" ? a.cozeFileId : undefined;
      const file_id = typeof a.file_id === "string" ? a.file_id : undefined;
      const file_name = typeof a.file_name === "string" ? a.file_name : undefined;
      // 至少要有一个引用方式
      if (!url && !cozeFileId && !file_id) return null;
      return { kind: a.kind, url, cozeFileId, file_id, file_name };
    })
    .filter((a): a is ParsedAtt => a !== null)
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

      let assistantContent = "";
      // 4.30up：移到 try 外层，让 finally 入库时可以把状态写进 attachments JSONB
      type AttachmentStatus = { file_name: string; ok: boolean; reason?: string };
      let attachmentStatuses: AttachmentStatus[] | null = null;
      try {
        // 4.30up：通用文档支持
        // 平台 capabilities.nativeDocuments === false 时，把 file 类型附件
        // 在 portal 后端预提取文本 → 拼到 message 正文里发给 AI
        // 这样元器（及任何不读文档的平台）也能"读"PDF/docx/txt
        let expandedMessage = message;
        let attachmentsForAdapter = attachments;
        if (!agent.capabilities.nativeDocuments) {
          const fileAtts = attachments.filter((a) => a.kind === "file" && a.url);
          const otherAtts = attachments.filter((a) => !(a.kind === "file" && a.url));
          if (fileAtts.length > 0) {
            attachmentStatuses = [];
            const blocks: string[] = [];
            for (const a of fileAtts) {
              const fileName = a.file_name ?? "file";
              const result = a.url
                ? await extractTextFromUrl(a.url, fileName)
                : null;
              if (result) {
                const truncatedNote = result.truncated
                  ? `\n[注：文档过长，已截取前 ${result.text.length} 字]`
                  : "";
                blocks.push(
                  `[附件: ${fileName}]\n${result.text}${truncatedNote}\n[/附件]`
                );
                attachmentStatuses.push({ file_name: fileName, ok: true });
              } else {
                // 提取失败：给 bot 明确指令，不要把 URL / 任何"假装看到了"的内容塞进去
                // 让 bot 直接告诉用户文件读不了，禁止编造内容
                blocks.push(
                  `[系统提示] 用户上传的附件「${fileName}」无法解析（文件可能已损坏或格式不支持）。请直接告知用户该附件读取失败，建议重新上传或检查文件格式，不要尝试推测或编造文件内容。`
                );
                attachmentStatuses.push({
                  file_name: fileName,
                  ok: false,
                  reason: "解析失败",
                });
              }
            }
            expandedMessage = blocks.join("\n\n") + (message ? "\n\n" + message : "");
            attachmentsForAdapter = otherAtts; // file 类已变成文本，不再当附件传
          }
        }

        // 4.30 批次1：附件全部提取完后、第一段 bot delta 之前发一帧
        // meta.attachment_status，让前端把 pending chip 翻成 ✓/⚠
        if (attachmentStatuses) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ meta: { attachment_status: attachmentStatuses } })}\n\n`
            )
          );
        }

        const userMessage = {
          role: "user" as const,
          content: expandedMessage,
          attachments:
            attachmentsForAdapter.length > 0
              ? attachmentsForAdapter.map((a) => ({
                  kind: a.kind,
                  fileName: a.file_name,
                  url: a.url,
                  cozeFileId: a.cozeFileId,
                  fileId: a.file_id, // legacy
                }))
              : undefined,
        };

        // Phase 1：非 Coze 平台无平台侧 conversation 持久化，需要把本地历史拼成
        // messages 数组发给 adapter；Coze 走自己 conversation_id + auto_save_history
        // 不必重复送历史
        let messagesForAdapter: ChatMessage[] = [userMessage];
        if (agent.platform !== "coze") {
          const { data: priorMsgs } = await db
            .from("trial_messages")
            .select("role, content")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: true });
          if (priorMsgs && priorMsgs.length > 0) {
            messagesForAdapter = [
              ...priorMsgs.map((m): ChatMessage => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
              userMessage,
            ];
          }
        }

        for await (const chunk of streamChat(messagesForAdapter, cfg)) {
          assistantContent += chunk;
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
        // 流结束（成功 / abort / 错误）都保留 chat 行 + 入库 user 消息
        // —— 不再回滚，避免前端拿到的 chat_id 失效导致后续消息 404 级联
        // —— assistant 消息仅在有内容时入库（避免空回复打乱顺序）
        {
          // 入库 user 消息（保留所有附件字段：url 通用，cozeFileId/file_id 平台特定）
          // 4.30up 修：把附件解析状态（ok/failed）一起写进 JSONB，刷新后 chip 仍能显示 ✓/⚠
          const { error: userInsertErr } = await db.from("trial_messages").insert({
            chat_id: chatId,
            role: "user",
            content: message,
            attachments:
              attachments.length > 0
                ? attachments.map((a) => {
                    const fileName = a.file_name;
                    const status = attachmentStatuses?.find(
                      (s) => s.file_name === fileName
                    );
                    return {
                      kind: a.kind,
                      file_name: a.file_name,
                      url: a.url,
                      cozeFileId: a.cozeFileId,
                      file_id: a.file_id, // legacy
                      ...(status
                        ? {
                            extractStatus: status.ok ? "ok" : "failed",
                            ...(status.reason ? { extractReason: status.reason } : {}),
                          }
                        : {}),
                    };
                  })
                : null,
          });
          if (userInsertErr) {
            console.error("[trial_chat] insert user msg failed:", userInsertErr);
          }
          // 入库 assistant 消息（即便 abort，partial 内容也保留）
          if (assistantContent) {
            const { error: assistantInsertErr } = await db.from("trial_messages").insert({
              chat_id: chatId,
              role: "assistant",
              content: assistantContent,
            });
            if (assistantInsertErr) {
              console.error("[trial_chat] insert assistant msg failed:", assistantInsertErr);
            }
          }

          // UPDATE chat 行：刷新 last_active_at；新会话时也要写入 coze_conversation_id
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
      // 关键：告诉 Nginx / 宝塔反代不要 buffering 这个 SSE 响应
      // 否则 stream chunk 会被反代缓存到超时切断 → 客户端 Failed to fetch
      "X-Accel-Buffering": "no",
    },
  });
}
