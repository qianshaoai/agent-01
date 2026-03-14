import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { streamChat, ChatMessage } from "@/lib/adapters";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const { message, history = [] } = await req.json();

  if (!message?.trim()) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  // 验证智能体所有权
  const { data: dbUser } = await db
    .from("users").select("id").eq("phone", user.phone).eq("tenant_code", user.tenantCode).single();
  if (!dbUser) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const { data: agent } = await db
    .from("user_agents").select("*").eq("id", id).eq("user_id", dbUser.id).eq("enabled", true).single();
  if (!agent) return NextResponse.json({ error: "智能体不存在或无权访问" }, { status: 404 });

  if (agent.agent_type === "external") {
    return NextResponse.json({ error: "外链型智能体不支持对话" }, { status: 400 });
  }

  // 构建消息列表（客户端传入历史 + 当前消息）
  const messages: ChatMessage[] = [
    ...(history as ChatMessage[]).slice(-20),
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const gen = streamChat(messages, {
          platform: agent.platform ?? "openai",
          apiEndpoint: agent.api_url ?? "",
          apiKey: agent.api_key_enc ?? "",
          modelParams: (agent.model_params ?? {}) as Record<string, unknown>,
          agentCode: agent.id,
          platformConvId: null,
          onPlatformConvId: () => {},
        });

        for await (const chunk of gen) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "AI 调用失败";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
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
    },
  });
}
