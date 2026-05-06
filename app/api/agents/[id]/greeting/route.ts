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
    .select("agent_code, platform, api_key_enc, model_params, enabled")
    .eq("agent_code", agentCode)
    .eq("enabled", true)
    .single();

  // agent 不存在 / 已禁用 / 非 Coze → 静默返回 null（前端拿到就当没开场白处理）
  if (!agent || agent.platform !== "coze") {
    return NextResponse.json({ prologue: null });
  }

  const modelParams = (agent.model_params ?? {}) as Record<string, unknown>;
  const botId = typeof modelParams["bot_id"] === "string" ? modelParams["bot_id"] : null;
  if (!botId) {
    return NextResponse.json({ prologue: null });
  }

  const token = decrypt(agent.api_key_enc);
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
