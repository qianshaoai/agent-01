import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { streamChat, ChatMessage } from "@/lib/adapters";
import { decrypt } from "@/lib/crypto";
import { withRequestLog } from "@/lib/request-logger";
import { isSummarizerConfigured, summarizeOlderHistory } from "@/lib/summarizer";

import { CHAT } from "@/lib/config";
const MAX_CONTEXT_TURNS = CHAT.MAX_CONTEXT_TURNS;
// 5.7up · 阶段二参数（默认值，调参可后续提到 lib/config.ts）
const SLIDING_WINDOW_MSGS = 12;   // 滑动窗口：6 轮 = 12 条消息原样保留
const HISTORY_LOAD_LIMIT = 200;    // 单次最多加载多少条未摘要消息（防超长会话内存爆）

export const POST = withRequestLog(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id: rawId } = await params;
  const agentCode = decodeURIComponent(rawId);
  const { message, conversationId, fileTexts, attachments } = await req.json();

  if (!message?.trim()) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    // ── 1. 查询智能体（含 API 配置）────────────────────────────
    const { data: agent } = await db
      .from("agents")
      .select("*")
      .eq("agent_code", agentCode)
      .eq("enabled", true)
      .single();

    if (!agent) {
      return NextResponse.json({ error: "智能体不存在或已禁用" }, { status: 404 });
    }

    // 外链型智能体不支持站内对话
    if (agent.agent_type === "external") {
      return NextResponse.json({ error: "此智能体为外链跳转型，请通过首页卡片访问" }, { status: 400 });
    }

    // ── 1.5 API Key 解析（5.7up · GPT 接入阶段一）────────────────
    // OpenAI 平台支持兜底到组织共享 key：
    //   优先用 agent 自带 key（保持原有行为）
    //   若 agent 自带 key 为空且 platform="openai" → 取该用户所属组织的
    //   tenants.openai_key_enc（由 super_admin 配置）
    let resolvedApiKey = decrypt(agent.api_key_enc);
    if (!resolvedApiKey && agent.platform === "openai" && user.tenantCode) {
      const { data: tCfg } = await db
        .from("tenants")
        .select("openai_key_enc")
        .eq("code", user.tenantCode)
        .single();
      if (tCfg?.openai_key_enc) {
        resolvedApiKey = decrypt(tCfg.openai_key_enc);
      }
    }
    if (!resolvedApiKey) {
      return NextResponse.json(
        { error: "智能体未配置 API Key，请联系管理员" },
        { status: 503 }
      );
    }

    // ── 2. 配额检查 ────────────────────────────────────────────
    if (!user.isPersonal) {
      const { data: tenant } = await db
        .from("tenants")
        .select("quota, quota_used, expires_at, enabled")
        .eq("code", user.tenantCode)
        .single();

      if (!tenant || !tenant.enabled) {
        return NextResponse.json({ error: "组织账号已禁用" }, { status: 403 });
      }
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "组织配额已到期，请联系管理员续期" }, { status: 403 });
      }
      if (tenant.quota_used >= tenant.quota) {
        return NextResponse.json({ error: "使用次数已耗尽，请联系管理员充值" }, { status: 403 });
      }
    }

    // ── 3. 会话管理 ────────────────────────────────────────────
    let convId = conversationId;
    let platformConvId: string | null = null;

    // 查询用户 id
    const { data: dbUser } = await db
      .from("users")
      .select("id")
      .eq("phone", user.phone)
      .eq("tenant_code", user.tenantCode)
      .single();

    if (!dbUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    // 5.7up · 阶段二：会话级摘要状态（首次接收消息时这两列都是 NULL）
    let convSummary: string | null = null;
    let convSummaryUntilAt: string | null = null;

    if (!convId) {
      // 新建会话，标题取消息前20字
      const title = message.slice(0, 20) + (message.length > 20 ? "…" : "");
      const { data: conv } = await db
        .from("conversations")
        .insert({ user_id: dbUser.id, agent_id: agent.id, title })
        .select()
        .single();
      convId = conv?.id;
    } else {
      // 更新会话时间，同时读取平台侧会话 ID + 摘要元信息
      const { data: conv } = await db
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId)
        .select("platform_conv_id, summary_text, summary_until_at")
        .single();
      platformConvId = conv?.platform_conv_id ?? null;
      convSummary = conv?.summary_text ?? null;
      convSummaryUntilAt = conv?.summary_until_at ?? null;
    }

    // ── 4. 加载上下文消息 ──────────────────────────────────────
    // 4.30up：aborted=true 的消息不进上下文。被中断的对话在前端仍渲染（已停止徽章），
    // 但 bot 后续问答看不到这些被截断的内容，避免污染回答质量。
    // 5.7up · 阶段二：只加载"摘要尚未覆盖"的消息（gt summary_until_at），单次上限 200 条。
    // 摘要器把更老的内容压成 convSummary 文本，无需再加载它们。
    // 兜底：migration_v22 没跑时退回不过滤 aborted 的查询；migration_v26 没跑时退回 limit MAX_CONTEXT_TURNS*2。
    type HistoryRow = { role: string; content: string; created_at: string };
    let messageQuery = db
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", convId)
      .eq("aborted", false)
      .order("created_at", { ascending: true })
      .limit(HISTORY_LOAD_LIMIT);
    if (convSummaryUntilAt) {
      messageQuery = messageQuery.gt("created_at", convSummaryUntilAt);
    }
    const filtered = await messageQuery;
    const historyRows = filtered.error
      ? (
          await db
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: true })
            .limit(MAX_CONTEXT_TURNS * 2)
        ).data
      : filtered.data;

    // 4.30 修：只保留成对 user → assistant 的历史，过滤掉悬空 user
    // 原因：上一轮 bot 失败 / abort 时 assistant 没入库，dangling user 留在 DB
    // 下次拼 messages 数组会出现连续两条 user，元器（及任何严格平台）400：
    // "请求消息中user与assistant角色没有交替出现"
    const rawHistory = (historyRows ?? []) as HistoryRow[];
    let history: HistoryRow[] = [];
    for (let i = 0; i < rawHistory.length; i++) {
      const cur = rawHistory[i];
      if (cur.role === "user") {
        const next = rawHistory[i + 1];
        if (next && next.role === "assistant") {
          history.push(cur, next);
          i++; // 跳过 next
        }
        // 否则丢弃 dangling user
      }
      // dangling assistant 不应出现，丢弃
    }

    // 5.7up · 阶段二：滑动窗口 + 增量摘要
    //   超过 SLIDING_WINDOW_MSGS 的部分（older）扔给便宜模型概括 → 合并入 convSummary
    //   摘要器只在配置了 SUMMARIZER_* 环境变量时启用；否则照旧（截断老历史）
    //   摘要失败 / 摘要器没配 → 继续走，summary 维持原值，不破坏聊天
    if (history.length > SLIDING_WINDOW_MSGS) {
      const older = history.slice(0, history.length - SLIDING_WINDOW_MSGS);
      const recent = history.slice(history.length - SLIDING_WINDOW_MSGS);

      if (isSummarizerConfigured() && older.length > 0) {
        const updatedSummary = await summarizeOlderHistory(
          convSummary,
          older.map((m) => ({ role: m.role, content: m.content }))
        );
        // 摘要返回 null（极少数）时不动；返回新文本则落库 + 更新 until_at
        if (updatedSummary && updatedSummary !== convSummary) {
          convSummary = updatedSummary;
          const lastOlderAt = older[older.length - 1].created_at;
          convSummaryUntilAt = lastOlderAt;
          // 异步落库，不阻塞当前响应（即使失败下次还会再算一次）
          db
            .from("conversations")
            .update({ summary_text: updatedSummary, summary_until_at: lastOlderAt })
            .eq("id", convId)
            .then(({ error }) => {
              if (error) console.warn("[chat] save summary failed:", error.message);
            });
        }
        // 主对话只用 recent
        history = recent;
      } else if (!isSummarizerConfigured()) {
        // 摘要器未配置：退化为截断（保持以前行为，避免 200 条全发出去把 GPT 撑爆）
        history = history.slice(-MAX_CONTEXT_TURNS * 2);
      }
      // 摘要器配置了但 older.length===0：不可能进这里（外层 length 检查保证）
    }

    // 如果有文件提取文本，拼入用户消息
    let userContent = message;
    if (fileTexts && fileTexts.length > 0) {
      userContent += "\n\n[附件内容]\n" + fileTexts.join("\n\n---\n\n");
    }

    // 4.30 修：图片附件走结构化 attachments → adapter 拼成 image_url 多模态
    // DB content 里只追加一行 [图片: name, URL: url] 标记，便于历史回显和编辑/重发
    type IncomingAttachment = { kind: "image" | "file"; url?: string; filename?: string };
    const incomingAtts: IncomingAttachment[] = Array.isArray(attachments) ? attachments : [];
    const imageAtts = incomingAtts.filter((a) => a.kind === "image" && a.url);
    let displayContent = userContent;
    if (imageAtts.length > 0) {
      // 幂等：URL 已经出现在 userContent 里（regenerate / edit 路径，message 自带旧图片标记）
      // 就跳过追加，否则同一图片会有两份标记
      const imgLines = imageAtts
        .filter((a) => !userContent.includes(a.url!))
        .map((a) => `[图片: ${a.filename ?? "图片"}，URL: ${a.url}]`);
      if (imgLines.length > 0) {
        const sep = userContent.includes("[附件内容]") ? "\n" : "\n\n[附件内容]\n";
        displayContent = userContent + sep + imgLines.join("\n");
      }
    }

    // 构建消息列表（系统提示 + 早期对话摘要 + 最近窗口 + 当前用户消息）
    const systemPrompt = (agent.model_params as Record<string, unknown>)["system_prompt"] as string | undefined;
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      // 5.7up · 阶段二：早期历史摘要作为额外 system 消息插在最前
      ...(convSummary
        ? [{ role: "system" as const, content: `【早期对话摘要】\n${convSummary}` }]
        : []),
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      {
        role: "user",
        content: userContent,
        // 把 image attachments 挂到 user message 上，adapter (yuanqi/coze) 会拼成
        // OpenAI 兼容的 {type: "image_url", image_url: {url}} 多模态 part
        ...(imageAtts.length > 0
          ? {
              attachments: imageAtts.map((a) => ({
                kind: "image" as const,
                url: a.url!,
                fileName: a.filename,
              })),
            }
          : {}),
      },
    ];

    // ── 5. 保存用户消息 ────────────────────────────────────────
    // displayContent 已包含图片 [图片: name, URL: url] 标记，便于历史回显
    await db.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: displayContent,
    });

    // ── 6. 流式调用 AI ────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullResponse = "";
    let newPlatformConvId: string | null = null;
    // 5.7up · GPT 接入：从 adapter 流式回调里捕获 token usage
    let capturedUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamChat(messages, {
            platform: agent.platform,
            apiEndpoint: agent.api_endpoint,
            apiKey: resolvedApiKey,
            modelParams: (agent.model_params ?? {}) as Record<string, unknown>,
            agentCode: agent.agent_code,
            platformConvId,
            onPlatformConvId: (id) => { newPlatformConvId = id; },
            onUsage: (u) => { capturedUsage = u; },
          });

          for await (const chunk of gen) {
            fullResponse += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }

          // 5.7up · 流式结束后：若有 usage（GPT），按模型权重扣额度并记 token
          // 否则维持原行为：固定扣 1 次（其它平台）
          const modelUsed = (agent.model_params as Record<string, unknown>)["model"] as string | undefined;
          let weight = 1;
          if (capturedUsage && modelUsed) {
            const { data: w } = await db
              .from("model_quota_weights")
              .select("weight_per_call, enabled")
              .eq("model_id", modelUsed)
              .single();
            if (w?.enabled) weight = w.weight_per_call;
          }

          // 流结束：保存 AI 回复 & 扣配额 & 写日志
          await Promise.all([
            db.from("messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: fullResponse,
            }),
            // 保存平台侧会话 ID（如清言 conversation_id）
            newPlatformConvId
              ? db.from("conversations").update({ platform_conv_id: newPlatformConvId }).eq("id", convId)
              : Promise.resolve(),
            user.isPersonal
              ? Promise.resolve()
              : (capturedUsage
                  ? db.rpc("increment_quota_used_weighted", { p_code: user.tenantCode, p_weight: weight })
                  : db.rpc("increment_quota_used", { p_code: user.tenantCode })),
            db.from("logs").insert({
              user_phone: user.phone,
              tenant_code: user.tenantCode,
              agent_code: agent.agent_code,
              agent_name: agent.name,
              action: "chat",
              status: "success",
              duration_ms: Date.now() - startTime,
              ...(capturedUsage
                ? {
                    prompt_tokens: (capturedUsage as { prompt_tokens: number }).prompt_tokens,
                    completion_tokens: (capturedUsage as { completion_tokens: number }).completion_tokens,
                    model_used: modelUsed ?? null,
                  }
                : {}),
            }),
          ]);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "AI 调用失败";
          // 4.30up：判断是否为 client abort——req.signal.aborted 为 true 即用户点了停止
          // abort 时入库已累积的 partial assistant + 把 user 也标 aborted=true，
          // 让"退出重进"后还能看到这条被中断的消息（带已停止徽章），同时下次 chat 历史
          // 因 .eq("aborted", false) 自动过滤这一对，不污染 bot 上下文
          const wasAborted = req.signal.aborted;
          if (wasAborted && fullResponse) {
            // 入库 partial assistant（可能 aborted 列没跑 v22 migration → 兜底重试一次不带 aborted）
            const ins = await db.from("messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: fullResponse,
              aborted: true,
            });
            if (ins.error) {
              await db.from("messages").insert({
                conversation_id: convId,
                role: "assistant",
                content: fullResponse,
              });
            }
          }
          if (wasAborted) {
            // 把刚入库的最近一条 user 也标 aborted（line 192 入库时是默认 false）
            const { data: lastUser } = await db
              .from("messages")
              .select("id")
              .eq("conversation_id", convId)
              .eq("role", "user")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastUser) {
              const upd = await db
                .from("messages")
                .update({ aborted: true })
                .eq("id", lastUser.id);
              if (upd.error) {
                // migration_v22 还没跑：忽略，前端的 PATCH 兜底也会再试一次
              }
            }
          }
          // controller 可能已被 client 关闭，enqueue 会抛 — 包 try
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
          } catch {}

          await db.from("logs").insert({
            user_phone: user.phone,
            tenant_code: user.tenantCode,
            agent_code: agent.agent_code,
            agent_name: agent.name,
            action: "chat",
            status: wasAborted ? "aborted" : "error",
            duration_ms: Date.now() - startTime,
            error_msg: errMsg,
          });
        } finally {
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Conversation-Id": convId ?? "",
        // 关键：告诉 nginx / 宝塔反代不要 buffering 这个 SSE 响应
        // 否则 stream chunk 会被反代缓存到超时切断 → 前端 "网络错误"
        // trial 路由 (app/api/trial/chat/route.ts) 早就加过这个 header
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("[chat]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
});
