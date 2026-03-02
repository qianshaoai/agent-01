import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { streamChat, ChatMessage } from "@/lib/adapters";

// 上下文窗口：最多取最近 N 轮（每轮 = user + assistant）
const MAX_CONTEXT_TURNS = 20;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: agentCode } = await params;
  const { message, conversationId, fileTexts } = await req.json();

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

    // ── 2. 配额检查 ────────────────────────────────────────────
    if (!user.isPersonal) {
      const { data: tenant } = await db
        .from("tenants")
        .select("quota, quota_used, expires_at, enabled")
        .eq("code", user.tenantCode)
        .single();

      if (!tenant || !tenant.enabled) {
        return NextResponse.json({ error: "企业账号已禁用" }, { status: 403 });
      }
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "企业配额已到期，请联系管理员续期" }, { status: 403 });
      }
      if (tenant.quota_used >= tenant.quota) {
        return NextResponse.json({ error: "使用次数已耗尽，请联系管理员充值" }, { status: 403 });
      }
    }

    // ── 3. 会话管理 ────────────────────────────────────────────
    let convId = conversationId;

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
      // 更新会话时间
      await db
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId);
    }

    // ── 4. 加载上下文消息 ──────────────────────────────────────
    const { data: historyRows } = await db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(MAX_CONTEXT_TURNS * 2);

    const history: ChatMessage[] = (historyRows ?? []) as ChatMessage[];

    // 如果有文件提取文本，拼入用户消息
    let userContent = message;
    if (fileTexts && fileTexts.length > 0) {
      userContent += "\n\n[附件内容]\n" + fileTexts.join("\n\n---\n\n");
    }

    // 构建消息列表（系统提示 + 历史 + 当前用户消息）
    const systemPrompt = (agent.model_params as Record<string, unknown>)["system_prompt"] as string | undefined;
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      ...history,
      { role: "user", content: userContent },
    ];

    // ── 5. 保存用户消息 ────────────────────────────────────────
    await db.from("messages").insert({
      conversation_id: convId,
      role: "user",
      content: userContent,
    });

    // ── 6. 流式调用 AI ────────────────────────────────────────
    const encoder = new TextEncoder();
    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamChat(messages, {
            platform: agent.platform,
            apiEndpoint: agent.api_endpoint,
            apiKey: agent.api_key_enc,
            modelParams: (agent.model_params ?? {}) as Record<string, unknown>,
            agentCode: agent.agent_code,
          });

          for await (const chunk of gen) {
            fullResponse += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }

          // 流结束：保存 AI 回复 & 扣配额 & 写日志
          await Promise.all([
            db.from("messages").insert({
              conversation_id: convId,
              role: "assistant",
              content: fullResponse,
            }),
            user.isPersonal
              ? Promise.resolve()
              : db.rpc("increment_quota_used", { p_code: user.tenantCode }),
            db.from("logs").insert({
              user_phone: user.phone,
              tenant_code: user.tenantCode,
              agent_code: agent.agent_code,
              agent_name: agent.name,
              action: "chat",
              status: "success",
              duration_ms: Date.now() - startTime,
            }),
          ]);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "AI 调用失败";
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));

          await db.from("logs").insert({
            user_phone: user.phone,
            tenant_code: user.tenantCode,
            agent_code: agent.agent_code,
            agent_name: agent.name,
            action: "chat",
            status: "error",
            duration_ms: Date.now() - startTime,
            error_msg: errMsg,
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": convId ?? "",
      },
    });
  } catch (e) {
    console.error("[chat]", e);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
