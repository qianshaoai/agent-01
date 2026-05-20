import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { streamChat, ChatMessage, TokenUsage } from "@/lib/adapters";
import { decrypt } from "@/lib/crypto";
import { withRequestLog } from "@/lib/request-logger";
import { retrieveKbChunks } from "@/lib/kb/retrieve";

import { CHAT } from "@/lib/config";
import { humanizeChatError } from "@/lib/chat-error";
const MAX_CONTEXT_TURNS = CHAT.MAX_CONTEXT_TURNS;

// 5.19up 知识库B · 组织用户对某 agent 是否有访问权 —— 与前台智能体列表 / 工作流同口径。
// chat route 原本不校验可见性（猜到 agent_code 就能聊）；挂知识库后会升级成「猜到 code
// 就能问出库里资料」的信息泄露 —— 故发起对话前先校验（母方案 §4.3 / 约束 §7.1）。
// 个人用户不在此校验内：维持现状（绕过权限表、可见全部 enabled 智能体，见 5.19up 可见范围 D4）。
async function orgUserCanSeeAgent(
  userId: string,
  tenantCode: string | null,
  agentId: string,
): Promise<boolean> {
  // 用户的 dept / team / group —— 细粒度 scope 匹配
  const [{ data: uRow }, { data: gRows }] = await Promise.all([
    db.from("users").select("dept_id, team_id").eq("id", userId).maybeSingle(),
    db.from("user_group_members").select("group_id").eq("user_id", userId),
  ]);
  const deptId = (uRow as { dept_id: string | null } | null)?.dept_id ?? null;
  const teamId = (uRow as { team_id: string | null } | null)?.team_id ?? null;
  const groupIds = (gRows ?? []).map((g: { group_id: string }) => g.group_id);

  // resource_permissions OR 条件 —— 与 /api/agents 的 buildOrgAccessQuery 同口径
  const orParts = [
    "scope_type.eq.all",
    "and(scope_type.eq.user_type,scope_id.eq.organization)",
    `and(scope_type.eq.user,scope_id.eq.${userId})`,
  ];
  if (tenantCode) orParts.push(`and(scope_type.eq.org,scope_id.eq.${tenantCode})`);
  if (deptId) orParts.push(`and(scope_type.eq.dept,scope_id.eq.${deptId})`);
  if (teamId) orParts.push(`and(scope_type.eq.team,scope_id.eq.${teamId})`);
  if (groupIds.length > 0) orParts.push(`and(scope_type.eq.group,scope_id.in.(${groupIds.join(",")}))`);
  const orFilter = orParts.join(",");

  // 1. 该 agent 本身有命中当前用户的权限行 → 可见
  const { data: agentHit } = await db
    .from("resource_permissions")
    .select("resource_id")
    .eq("resource_type", "agent")
    .eq("resource_id", agentId)
    .or(orFilter)
    .limit(1);
  if (agentHit && agentHit.length > 0) return true;

  // 2. 工作流步骤兜底：该 agent 是某个「用户可访问且 enabled 工作流的 enabled 步骤」→ 放行。
  //    工作流运行时经 /agents/[code] 进入对话，步骤 agent 未必有独立权限行，不放行会把
  //    正常工作流跑断（约束 §8.2「非知识库智能体路径不受影响」）。
  //    ⚠ 小B 验收 finding 1：**必须同时校验 step.enabled + workflow.enabled**，否则
  //    禁用工作流 / 禁用步骤会成为越权后门（用户绕开禁用闸刀间接访问 agent）。
  const { data: stepRows } = await db
    .from("workflow_steps")
    .select("workflow_id")
    .eq("agent_id", agentId)
    .eq("enabled", true);
  const candidateWfIds = [
    ...new Set((stepRows ?? []).map((s: { workflow_id: string }) => s.workflow_id).filter(Boolean)),
  ];
  if (candidateWfIds.length === 0) return false;

  // 收口：只取 enabled=true 的工作流；禁用工作流不放行
  const { data: enabledWfRows } = await db
    .from("workflows")
    .select("id, visible_to")
    .in("id", candidateWfIds)
    .eq("enabled", true);
  const wfRows = (enabledWfRows ?? []) as { id: string; visible_to: string | null }[];
  const wfIds = wfRows.map((w) => w.id);
  if (wfIds.length === 0) return false;

  // 2a. 工作流命中用户权限行（新口径）
  const { data: wfHit } = await db
    .from("resource_permissions")
    .select("resource_id")
    .eq("resource_type", "workflow")
    .in("resource_id", wfIds)
    .or(orFilter)
    .limit(1);
  if (wfHit && wfHit.length > 0) return true;

  // 2b. 兼容旧数据：workflows.visible_to 为 "all" 或逗号分隔组织码（未迁到权限表的工作流）
  const tc = (tenantCode ?? "").toUpperCase();
  for (const w of wfRows) {
    const vt = String(w.visible_to ?? "");
    if (vt === "all") return true;
    if (vt.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).includes(tc)) return true;
  }
  return false;
}

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
  const { message, conversationId, fileTexts, attachments, workflowContext, workflowReferenceLabel, sessionId } = await req.json();

  if (!message?.trim()) {
    return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    // ── 1. 查询智能体（含 API 配置）────────────────────────────
    // 5.15up bugfix · 同 tenant 那个 bug：.single() 在 fetch failed 时也返回 data:null，
    // 被误报为"智能体不存在或已禁用"。改 maybeSingle + 加 error 检查，
    // 并把 enabled 过滤从 SQL 移到代码层，区分"agent 不存在"和"agent 被禁用"两种情况
    const { data: agent, error: agentErr } = await db
      .from("agents")
      .select("*")
      .eq("agent_code", agentCode)
      .maybeSingle();

    if (agentErr) {
      console.error(`[chat] load agent failed for ${agentCode}:`, agentErr.message);
      return NextResponse.json({ error: "加载智能体失败，请稍后重试" }, { status: 503 });
    }
    if (!agent) {
      return NextResponse.json({ error: "智能体不存在" }, { status: 404 });
    }
    if (!agent.enabled) {
      return NextResponse.json({ error: "该智能体已被管理员禁用" }, { status: 403 });
    }

    // 外链型智能体不支持站内对话
    if (agent.agent_type === "external") {
      return NextResponse.json({ error: "此智能体为外链跳转型，请通过首页卡片访问" }, { status: 400 });
    }

    // ── 1.5 前置可见性校验（5.19up 知识库B · 收口「猜到 code 就能聊」的安全缺口）──
    // 个人用户维持现状（不校验、绕过权限表，见 5.19up 可见范围 D4）；组织用户必须对该
    // agent 有可见权（直接授权 / 工作流步骤），否则 403。挂知识库后此校验防资料外泄。
    if (!user.isPersonal) {
      const canSee = await orgUserCanSeeAgent(user.userId, user.tenantCode, agent.id);
      if (!canSee) {
        return NextResponse.json({ error: "你没有访问该智能体的权限" }, { status: 403 });
      }
    }

    // ── 2. 解析模型配置 + API key + 算 weight ──────────────────
    // W2：提到配额检查之前 —— 加权配额检查需要 weight。
    // 配置解析优先级（5.15up PR-2 · 小B 评审）：
    //   1) agent.provider_id 存在 → 强制走 model_providers；provider 删除/禁用/无 key
    //      /endpoint 空/解密失败一律阻断，不 fallback 旧 api_key_enc
    //   2) provider_id 空 + agent.api_key_enc → 用旧 agent 自带 key
    //   3) 仍无 + platform=openai + 租户 openai_key_enc → 租户 key 兜底
    //   4) 都没有 → 503
    let resolvedPlatform: string = agent.platform;
    let resolvedEndpoint: string = agent.api_endpoint;
    let resolvedApiKey: string;
    let resolvedModelParams: Record<string, unknown> = (agent.model_params ?? {}) as Record<string, unknown>;
    let providerDefaultModel = "";

    try {
      if (agent.provider_id) {
        const { data: provider, error: provErr } = await db
          .from("model_providers")
          .select("platform, api_endpoint, api_key_enc, default_model, default_params, enabled")
          .eq("id", agent.provider_id)
          .maybeSingle();
        if (provErr) {
          console.error(`[chat] load provider failed for ${agent.agent_code}:`, provErr.message);
          return NextResponse.json({ error: "加载模型供应商失败，请稍后重试" }, { status: 503 });
        }
        if (!provider) return NextResponse.json({ error: "智能体绑定的模型供应商已删除，请联系管理员" }, { status: 503 });
        if (!provider.enabled) return NextResponse.json({ error: "智能体绑定的模型供应商已禁用，请联系管理员" }, { status: 503 });
        if (!provider.api_key_enc) return NextResponse.json({ error: "智能体绑定的模型供应商未配置 API Key，请联系管理员" }, { status: 503 });
        if (!provider.api_endpoint) return NextResponse.json({ error: "智能体绑定的模型供应商未配置接口地址，请联系管理员" }, { status: 503 });
        resolvedPlatform = provider.platform;
        resolvedEndpoint = provider.api_endpoint;
        resolvedApiKey = decrypt(provider.api_key_enc);
        providerDefaultModel = typeof provider.default_model === "string" ? provider.default_model : "";
        resolvedModelParams = {
          ...((provider.default_params ?? {}) as Record<string, unknown>),
          ...((agent.model_params ?? {}) as Record<string, unknown>),
        };
      } else if (agent.api_key_enc) {
        resolvedApiKey = decrypt(agent.api_key_enc);
      } else if (agent.platform === "openai" && user.tenantCode) {
        const { data: tCfg } = await db
          .from("tenants")
          .select("openai_key_enc")
          .eq("code", user.tenantCode)
          .single();
        if (!tCfg?.openai_key_enc) {
          return NextResponse.json({ error: "智能体未配置 API Key，请联系管理员" }, { status: 503 });
        }
        resolvedApiKey = decrypt(tCfg.openai_key_enc);
      } else {
        return NextResponse.json({ error: "智能体未配置模型 API，请联系管理员" }, { status: 503 });
      }
    } catch (e) {
      console.error(`[chat] decrypt failed for ${agent.agent_code}:`, e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "该智能体 API key 不可用，请联系管理员" }, { status: 503 });
    }
    if (!resolvedApiKey) {
      return NextResponse.json({ error: "智能体 API Key 为空，请联系管理员" }, { status: 503 });
    }

    // W2 · 当前模型：agent.model_params.model → provider.default_model →
    //   （仅 openai 平台）"gpt-4o-mini"，与 openai 适配器内部兜底对齐，
    //   保证 日志模型 / 扣费模型 / 真实调用模型 一致。
    const agentMp = (agent.model_params ?? {}) as Record<string, unknown>;
    let modelUsed: string =
      (typeof agentMp.model === "string" && agentMp.model) || providerDefaultModel || "";
    if (!modelUsed && resolvedPlatform === "openai") modelUsed = "gpt-4o-mini";
    if (modelUsed) resolvedModelParams = { ...resolvedModelParams, model: modelUsed };

    // W2 · 算 weight（决策 3/4：模型在 model_quota_weights 里 enabled 才加权；
    //   查不到 / 未 enabled → weight=1 软放过；不依赖是否拿到 usage）。
    //   同一个 weight 给「带权重配额预检查」和「扣费」复用。
    let weight = 1;
    if (modelUsed) {
      const { data: w, error: wErr } = await db
        .from("model_quota_weights")
        .select("weight_per_call, enabled")
        .eq("model_id", modelUsed)
        .maybeSingle();
      // P3（小B PR-2 评审）：查询出错不能静默当 weight=1 —— 贵模型会被少扣。
      // 与"配额检查 DB 故障即 503"同口径，阻断报错。
      if (wErr) {
        console.error(`[chat] 加载模型权重失败 model=${modelUsed} agent=${agent.agent_code}:`, wErr.message);
        return NextResponse.json({ error: "加载配额配置失败，请稍后重试" }, { status: 503 });
      }
      if (w && w.enabled && typeof w.weight_per_call === "number" && w.weight_per_call > 0) {
        weight = w.weight_per_call;
      }
    }

    // ── 3. 配额检查（带权重）────────────────────────────────────
    if (!user.isPersonal) {
      // 5.15up bugfix · 区分"DB 故障"和"组织不存在/禁用"
      // 之前 `.single()` 在 ECONNRESET 时也返回 data:null，被误报为"组织账号已禁用"
      const { data: tenant, error: tenantErr } = await db
        .from("tenants")
        .select("quota, quota_used, expires_at, enabled")
        .eq("code", user.tenantCode)
        .maybeSingle();

      if (tenantErr) {
        console.error("[chat] load tenant failed:", tenantErr.message);
        return NextResponse.json({ error: "加载组织信息失败，请稍后重试" }, { status: 503 });
      }
      if (!tenant) {
        return NextResponse.json({ error: "组织不存在" }, { status: 403 });
      }
      if (!tenant.enabled) {
        return NextResponse.json({ error: "组织账号已禁用" }, { status: 403 });
      }
      if (new Date(tenant.expires_at) < new Date()) {
        return NextResponse.json({ error: "组织配额已到期，请联系管理员续期" }, { status: 403 });
      }
      // W2 · 带权重预检查（小B finding 1，方案甲）：与 increment_quota_used_weighted
      //   内部守卫 `quota_used + weight <= quota` 口径一致，不漏扣、不超扣。
      if (tenant.quota_used + weight > tenant.quota) {
        return NextResponse.json(
          {
            error: weight > 1
              ? `使用次数不足：本次（${modelUsed}）每次需 ${weight} 次额度，剩余不够，请联系管理员充值`
              : "使用次数已耗尽，请联系管理员充值",
          },
          { status: 403 }
        );
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

    if (!convId) {
      // 新建会话，标题取消息前20字
      const title = message.slice(0, 20) + (message.length > 20 ? "…" : "");
      const insertPayload: Record<string, unknown> = { user_id: dbUser.id, agent_id: agent.id, title };
      // 工作流会话隔离：携带 sessionId 时打标记，使对话归属该 session
      if (sessionId) insertPayload.session_id = sessionId;
      const { data: conv } = await db
        .from("conversations")
        .insert(insertPayload)
        .select()
        .single();
      convId = conv?.id;
    } else {
      // 更新会话时间，同时读取平台侧会话 ID
      const { data: conv } = await db
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId)
        .select("platform_conv_id")
        .single();
      platformConvId = conv?.platform_conv_id ?? null;
    }

    // ── 4. 加载上下文消息 ──────────────────────────────────────
    // 4.30up：aborted=true 的消息不进上下文。被中断的对话在前端仍渲染（已停止徽章），
    // 但 bot 后续问答看不到这些被截断的内容，避免污染回答质量。
    // 兜底：migration_v22 还没跑时回退到不过滤 aborted 的查询。
    const filtered = await db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .eq("aborted", false)
      .order("created_at", { ascending: true })
      .limit(MAX_CONTEXT_TURNS * 2);
    const historyRows = filtered.error
      ? (
          await db
            .from("messages")
            .select("role, content")
            .eq("conversation_id", convId)
            .order("created_at", { ascending: true })
            .limit(MAX_CONTEXT_TURNS * 2)
        ).data
      : filtered.data;

    // 4.30 修：只保留成对 user → assistant 的历史，过滤掉悬空 user
    // 原因：上一轮 bot 失败 / abort 时 assistant 没入库，dangling user 留在 DB
    // 下次拼 messages 数组会出现连续两条 user，元器（及任何严格平台）400：
    // "请求消息中user与assistant角色没有交替出现"
    const rawHistory = (historyRows ?? []) as ChatMessage[];
    // 5.12up · 去掉 user 消息开头的 [参考：xx]\n 标记 —— 这是前端 chip UI 用的标签，
    // 不该让 AI 看到（否则 AI 会把它当成访问不了的链接 / 引用，影响回答质量）
    const stripRefMarker = (content: string) => content.replace(/^\[参考：[^\]]+\]\n/, "");
    const history: ChatMessage[] = [];
    for (let i = 0; i < rawHistory.length; i++) {
      const cur = rawHistory[i];
      if (cur.role === "user") {
        const next = rawHistory[i + 1];
        if (next && next.role === "assistant") {
          history.push({ ...cur, content: stripRefMarker(cur.content) }, next);
          i++; // 跳过 next
        }
        // 否则丢弃 dangling user
      }
      // dangling assistant 不应出现，丢弃
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
    // 5.12up · 进度条参考：prepend 一个标记到 displayContent，前端解析后显示成 chip
    // 实际的上下文内容已通过 workflowContext 拼到 AI prompt 里，标记只是个标签
    if (workflowContext && typeof workflowReferenceLabel === "string" && workflowReferenceLabel.trim()) {
      displayContent = `[参考：${workflowReferenceLabel.trim()}]\n${displayContent}`;
    }
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

    // ── 5.19up 知识库B · 条件检索：绑库的对话型智能体，按本轮问题取 top-K 片段注入 ──
    // 仅 openai / 智谱平台（约束 §7.1：扣子 / Dify / 元器 / 清言等外部平台不接检索）。
    // 检索失败（embedding 桩未实现 / RPC 报错 / 表未就绪）→ 降级为无知识库正常回答、不阻断对话。
    let kbContextMessage: ChatMessage | null = null;
    if (resolvedPlatform === "openai" || resolvedPlatform === "zhipu") {
      try {
        const { data: kbRows, error: kbErr } = await db
          .from("agent_knowledge_bases")
          .select("kb_id")
          .eq("agent_id", agent.id);
        if (kbErr) throw new Error(kbErr.message);
        const kbIds = (kbRows ?? [])
          .map((r: { kb_id: string }) => r.kb_id)
          .filter(Boolean);
        if (kbIds.length > 0) {
          const chunks = await retrieveKbChunks(kbIds, message);
          if (chunks.length > 0) {
            const refBlock = chunks
              .map((c, i) => `【资料 ${i + 1}】\n${c.content}`)
              .join("\n\n");
            kbContextMessage = {
              role: "system",
              content:
                "以下是从内部知识库检索到的、与用户问题相关的资料 —— 视为权威事实。\n" +
                "硬规则：\n" +
                "① 回答**必须严格以这些资料为准**；\n" +
                "② **即便与你的训练常识冲突，也以资料为唯一事实依据**，不得用常识反驳、纠正或质疑资料内容；\n" +
                "③ 资料未覆盖的部分才可用常识回答，且回答时必须明确标注「以下来自常识、非知识库」。\n\n" +
                refBlock,
            };
          }
        }
      } catch (e) {
        console.warn(
          `[chat] 知识库检索失败，降级为无知识库回答 agent=${agent.agent_code}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // 构建消息列表（系统提示 + 知识库资料 + 历史 + 当前用户消息）
    const systemPrompt = (agent.model_params as Record<string, unknown>)["system_prompt"] as string | undefined;
    // 工作流跨步骤上下文：拼入 userContent 而非 system 消息，兼容 Coze/Dify/Yuanqi 等不支持 system role 的平台。
    // displayContent（入库/前端展示）不含上下文，用户看不到。
    const wfCtx = typeof workflowContext === "string" && workflowContext.trim()
      ? workflowContext.trim()
      : null;
    const aiUserContent = wfCtx
      ? `【上一步工作记录】\n${wfCtx}\n\n【当前问题】\n${userContent}`
      : userContent;
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      // 5.19up 知识库B · 知识库资料注入在系统提示之后、历史之前（母方案 §4.3）
      ...(kbContextMessage ? [kbContextMessage] : []),
      ...history,
      {
        role: "user",
        content: aiUserContent,
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
    // 配置解析（resolvedPlatform/Endpoint/ApiKey/ModelParams）+ 模型 + weight
    // 已在上面「步骤 2」完成 —— W2 要求把它提到配额检查之前。
    const encoder = new TextEncoder();
    let fullResponse = "";
    let newPlatformConvId: string | null = null;
    // W1 · token 用量（仅 openai 平台会回调；其它平台保持 null）
    let capturedUsage: TokenUsage | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamChat(messages, {
            platform: resolvedPlatform,
            apiEndpoint: resolvedEndpoint,
            apiKey: resolvedApiKey,
            modelParams: resolvedModelParams,
            agentCode: agent.agent_code,
            platformConvId,
            onPlatformConvId: (id) => { newPlatformConvId = id; },
            onUsage: (u) => { capturedUsage = u; },
          });

          for await (const chunk of gen) {
            fullResponse += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }

          // 5.12up · 空响应保护：上游 AI 平台偶尔会 200 ok 但内容是空（风控拦截 / 模型偶发失败）
          // 这种情况不入库、不扣配额、不写 success 日志，转成 error 事件给前端
          if (!fullResponse.trim()) {
            await db.from("logs").insert({
              user_phone: user.phone,
              tenant_code: user.tenantCode,
              agent_code: agent.agent_code,
              agent_name: agent.name,
              action: "chat",
              status: "error",
              duration_ms: Date.now() - startTime,
              error_msg: "AI 返回空内容",
            });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI 没有返回内容，请重新发送或换种方式提问" })}\n\n`));
            return;
          }

          // W2 · 扣配额 —— 不再塞进 Promise.all 静默跑（小B 复评）：
          //   weight>1 走加权 RPC，否则走原按次 RPC；都检查结果，失败/没扣成要告警。
          if (!user.isPersonal) {
            const ded =
              weight > 1
                ? await db.rpc("increment_quota_used_weighted", { p_code: user.tenantCode, p_weight: weight })
                : await db.rpc("increment_quota_used", { p_code: user.tenantCode });
            // P2（小B PR-2 评审）：data===false 对两种 RPC 都查 —— 并发下
            // weight=1 的 increment_quota_used 也可能返回 false（没扣成），不能静默放过。
            if (ded.error) {
              console.error(`[chat] 扣配额失败 tenant=${user.tenantCode} weight=${weight} agent=${agent.agent_code}:`, ded.error.message);
            } else if (ded.data === false) {
              console.error(`[chat] 扣配额未生效 tenant=${user.tenantCode} weight=${weight} agent=${agent.agent_code} —— 余额不足或并发抢额度`);
            }
          }

          // 流结束：保存 AI 回复 & 写日志
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
            db.from("logs").insert({
              user_phone: user.phone,
              tenant_code: user.tenantCode,
              agent_code: agent.agent_code,
              agent_name: agent.name,
              action: "chat",
              status: "success",
              duration_ms: Date.now() - startTime,
              // W1 · token 用量统计（仅 openai 平台有 capturedUsage；modelUsed 知道就记）
              ...(modelUsed ? { model_used: modelUsed } : {}),
              ...(capturedUsage
                ? {
                    prompt_tokens: capturedUsage.prompt_tokens,
                    completion_tokens: capturedUsage.completion_tokens,
                  }
                : {}),
            }),
          ]);

          // W2 补丁：done 带回本次 weight，供前端「剩余次数」计数器按权重递减（gpt-4o 扣 5 等）
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: convId, weight })}\n\n`));
        } catch (err) {
          const rawMsg = err instanceof Error ? err.message : "AI 调用失败";
          // 5.15up · 把英文/技术性错误翻译成员工能看懂的中文
          const errMsg = humanizeChatError(rawMsg);
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
