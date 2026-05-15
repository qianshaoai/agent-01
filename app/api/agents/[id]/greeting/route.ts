import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/[id]/greeting
 *
 * 拉取 agent 在原平台后台配置的"开场白"（onboarding prologue），
 * 用于聊天页空白态时给用户先展示一条 bot 主动问候。
 *
 * - 不入库 / 不扣配额：纯透传 + 包装平台原生接口的结果
 * - 当前仅支持 Coze 平台；其它平台返回 { prologue: null }
 *
 * 返回：{ prologue: string | null; suggested_questions?: string[] }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id: rawId } = await params;
  const agentCode = decodeURIComponent(rawId);

  const { data: agent } = await db
    .from("agents")
    .select("agent_code, platform, api_key_enc, model_params, builder_config, provider_id, enabled")
    .eq("agent_code", agentCode)
    .eq("enabled", true)
    .single();

  if (!agent) {
    return NextResponse.json({ prologue: null });
  }

  // 5.14up PR-D · 优先返回 builder_config.opening_message（搭建器统一设置的开场白）
  // 这是平台层面的开场白，不依赖具体厂商，PR-C 发布的 agent 直接用这条
  const builderConfig = (agent.builder_config ?? {}) as Record<string, unknown>;
  const opening = typeof builderConfig.opening_message === "string"
    ? builderConfig.opening_message.trim()
    : "";
  const suggested = Array.isArray(builderConfig.suggested_questions)
    ? (builderConfig.suggested_questions as unknown[]).filter(
        (q): q is string => typeof q === "string" && q.trim().length > 0
      )
    : [];
  if (opening) {
    return NextResponse.json({
      prologue: opening,
      suggested_questions: suggested,
    });
  }

  // 老路径：非 Coze 智能体直接返回 null
  if (agent.platform !== "coze") {
    return NextResponse.json({ prologue: null });
  }

  const modelParams = (agent.model_params ?? {}) as Record<string, unknown>;
  const botId = typeof modelParams["bot_id"] === "string" ? modelParams["bot_id"] : null;
  if (!botId) {
    return NextResponse.json({ prologue: null });
  }

  // 5.14up Fix 3 · decrypt 失败时不再返回密文穿透，而是抛错 → 这里要包 try-catch，
  // 失败时静默走"无开场白"路径（跟 token 为空时一致），避免把内部错误传到前端 500
  let token: string;
  try {
    token = decrypt(agent.api_key_enc);
  } catch (e) {
    console.warn(`[greeting] decrypt failed for ${agentCode}:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ prologue: null });
  }
  if (!token) {
    return NextResponse.json({ prologue: null });
  }

  try {
    const res = await fetch(
      `https://api.coze.cn/v1/bot/get_online_info?bot_id=${encodeURIComponent(botId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      console.warn(
        `[greeting] coze HTTP ${res.status} for ${agentCode}/bot=${botId}: ${(await res.text()).slice(0, 200)}`
      );
      return NextResponse.json({ prologue: null });
    }

    const json = await res.json();
    if (json.code !== 0) {
      console.warn(
        `[greeting] coze code=${json.code} msg=${json.msg} for ${agentCode}/bot=${botId}`
      );
      return NextResponse.json({ prologue: null });
    }

    const onboarding = (json.data?.onboarding_info ?? {}) as {
      prologue?: string;
      suggested_questions?: string[] | null;
    };
    const prologue =
      typeof onboarding.prologue === "string" && onboarding.prologue.trim()
        ? onboarding.prologue.trim()
        : null;
    const suggested = Array.isArray(onboarding.suggested_questions)
      ? onboarding.suggested_questions.filter(
          (q): q is string => typeof q === "string" && q.trim().length > 0
        )
      : [];

    console.log(`[greeting] ${agentCode}: prologue=${prologue ? prologue.slice(0, 30) + "…" : "null"}`);
    return NextResponse.json({ prologue, suggested_questions: suggested });
  } catch (e) {
    console.error(`[greeting] error ${agentCode}:`, e);
    return NextResponse.json({ prologue: null });
  }
}
