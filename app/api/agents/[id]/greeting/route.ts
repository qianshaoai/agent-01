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

  // agent 不存在 / 已禁用 → 静默返回 null（前端拿到就当没开场白处理）
  if (!agent) {
    return NextResponse.json({ prologue: null });
  }

  // 5.15up · 平台无关 · 优先用平台侧自己存的开场白
  //    清言 / 元器 / Dify / OpenAI 等平台没有"读取开场白"的 API，无法自动拉取；
  //    管理员在智能体「模型参数 JSON」里填 opening_message（可选 suggested_questions）
  //    即可让任意平台的智能体显示开场白。
  //    builder_config.opening_message（搭建器发布的 agent）优先级高于 model_params。
  {
    const bc = (agent.builder_config ?? {}) as Record<string, unknown>;
    const mp = (agent.model_params ?? {}) as Record<string, unknown>;
    const stored =
      (typeof bc.opening_message === "string" && bc.opening_message.trim()) ||
      (typeof mp.opening_message === "string" && mp.opening_message.trim()) ||
      "";
    if (stored) {
      const rawSq = Array.isArray(bc.suggested_questions)
        ? bc.suggested_questions
        : Array.isArray(mp.suggested_questions)
        ? mp.suggested_questions
        : [];
      const suggested = rawSq.filter(
        (q): q is string => typeof q === "string" && q.trim().length > 0
      );
      return NextResponse.json({ prologue: stored, suggested_questions: suggested });
    }
  }

  // 没有平台侧开场白 → 仅 Coze 走原平台后台 prologue 自动拉取兜底
  if (agent.platform !== "coze") {
    return NextResponse.json({ prologue: null });
  }

  const modelParams = (agent.model_params ?? {}) as Record<string, unknown>;
  const botId = typeof modelParams["bot_id"] === "string" ? modelParams["bot_id"] : null;
  if (!botId) {
    return NextResponse.json({ prologue: null });
  }

  // 5.15up · 与 chat route 对齐的 key 解析：provider_id 非空时**严格**从 provider 取 key，
  // provider 删除/禁用/无 key/解密失败 → 返回无开场白（warn 记录），**不 fallback 旧 key**。
  // 否则集中禁用/更新 key 后，开场白这条链路仍会拿旧 key 绕过集中管理。
  // Fix 3 · decrypt 失败抛错，用 try-catch 兜成"无开场白"，不把内部错误透到前端。
  let token: string;
  try {
    if (agent.provider_id) {
      const { data: provider, error: provErr } = await db
        .from("model_providers")
        .select("api_key_enc, enabled")
        .eq("id", agent.provider_id)
        .maybeSingle();
      if (provErr || !provider || !provider.enabled || !provider.api_key_enc) {
        console.warn(`[greeting] provider 不可用 for ${agentCode} (provider_id=${agent.provider_id})`);
        return NextResponse.json({ prologue: null });
      }
      token = decrypt(provider.api_key_enc);
    } else {
      token = decrypt(agent.api_key_enc);
    }
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
