import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { streamChat, ChatMessage } from "@/lib/adapters";
import { writeAuditLog } from "@/lib/audit";
import { canReadRow, canWriteRow, requireWriteAccess } from "@/lib/scoped-access";

// 5.14up PR-A · 模型供应商连通性测试
// 权限：
//   - 5.30up · A 半 RBAC：test 写白名单含 system_admin（与 POST/PATCH/DELETE 不同口径，
//     test 不修改资源仅是只读探针，对 system_admin 沿用 5.14up 现状的"仅查/测"权限）
//   - org_admin 仅可测自己 org 的（canWriteRow 判归属）
//   不返回 key 明文。
//
// 行为：用最小 messages 发一次流式对话，限制 10 秒超时，
// 返回 { success, latency_ms, sample_text? , error? }，错误信息脱敏（不带 Authorization / key）
//
// 2026-05-29 · 删除自定义模型探针（搭建器 ?model= 覆盖 + /models 预检），仅保留
//   provider 默认模型连通测试。原因：第三方 OpenAI 兼容中转的 /models 列表 ID 与
//   OpenAI 标称命名不一致，silently 路由让 chat 探针几乎必误报，体感比"不让填"
//   还糟。搭建器现在只能从 preset 推荐模型里挑，不再需要 query 覆盖。
//   原 R5 Fix 4 的 deriveModelsListUrl / checkModelInList 两个 helper 一并删除。
//   连「上游必须实际回复『连接成功』」的硬校验保留（对默认模型测试也是有效收紧）。

const TIMEOUT_MS = 10_000;
const TEST_PROMPT = '请只回复"连接成功"四个字。';
const TEST_EXPECTED_TEXT = "连接成功";

type ProviderRow = {
  id: string;
  provider_code: string;
  name: string;
  platform: string;
  api_endpoint: string;
  api_key_enc: string;
  default_model: string;
  default_params: Record<string, unknown>;
  enabled: boolean;
  // 5.30up · 归属字段（canReadRow / canWriteRow 用）
  tenant_code: string | null;
};

function maskError(msg: string): string {
  // 脱敏：去掉可能的 Bearer xxx、Authorization、key 明文
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-+/=.]+/gi, "Bearer ***")
    .replace(/Authorization:\s*[^\s,]+/gi, "Authorization: ***")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9_\-+/=.]+/gi, "$1***")
    .slice(0, 500); // 截断超长 stack trace
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.30up · R2 §1 双闸：test 白名单含 system_admin（仅查/测口径沿用）
  const gate = requireWriteAccess(admin, ["super_admin", "system_admin", "org_admin"]);
  if (gate) return gate;

  const { id } = await params;
  const { data: row, error: loadError } = await db
    .from("model_providers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("[model-providers test load]", loadError);
    return apiError("加载供应商失败", "INTERNAL_ERROR");
  }
  const provider = row as (ProviderRow & { category?: string }) | null;
  if (!provider) return apiError("供应商不存在", "NOT_FOUND");

  // 5.30up · 归属判定：org_admin 不可见 → 404 屏蔽；可见但非 own → 403（仅 own 可测）
  if (!canReadRow(admin, provider)) return apiError("供应商不存在", "NOT_FOUND");
  if (!canWriteRow(admin, provider)) {
    return apiError("无权测试该供应商（仅可测自己组织的）", "FORBIDDEN");
  }

  if (!provider.enabled) return apiError("供应商已禁用，无法测试", "VALIDATION_ERROR");
  if (!provider.api_key_enc) return apiError("供应商未配置 API Key", "VALIDATION_ERROR");
  // 5.15up · 智能体 API 是平台凭证，对话需 bot_id（在智能体上、不在凭证里），
  // 无法在凭证层做连通测试 —— 直接拒绝，避免发出无效请求误报"上游返回空响应"
  if (provider.category === "agent") {
    return apiError(
      "智能体 API 为平台凭证，无法做对话连通测试；请在绑定该 API 的智能体里发消息验证",
      "VALIDATION_ERROR"
    );
  }

  let apiKey: string;
  try {
    apiKey = decrypt(provider.api_key_enc);
  } catch (e) {
    console.error("[model-providers test decrypt]", e);
    return apiError("API Key 解密失败，请重新配置", "INTERNAL_ERROR");
  }
  if (!apiKey) return apiError("API Key 解密为空，请重新配置", "INTERNAL_ERROR");

  const startTime = Date.now();
  const model = (provider.default_params?.model as string) || provider.default_model || "";

  const messages: ChatMessage[] = [
    { role: "user", content: TEST_PROMPT },
  ];

  // 合并 modelParams（model 必填给 openai-compatible）
  const modelParams: Record<string, unknown> = {
    ...provider.default_params,
    ...(model ? { model } : {}),
    max_tokens: 32, // 测试只要短回复
  };

  let sample = "";
  let success = false;
  let errMsg: string | null = null;

  try {
    const gen = streamChat(messages, {
      platform: provider.platform,
      apiEndpoint: provider.api_endpoint,
      apiKey,
      modelParams,
      agentCode: provider.provider_code ?? provider.id,
    });

    const deadline = Date.now() + TIMEOUT_MS;
    for await (const chunk of gen) {
      sample += chunk;
      if (sample.length > 200) break; // 拿到足够多就提前结束
      if (Date.now() > deadline) {
        errMsg = `测试超时（> ${TIMEOUT_MS / 1000} 秒未完成）`;
        break;
      }
    }
    const normalizedSample = sample.replace(/\s+/g, "");
    if (!errMsg) {
      // 5.30.1 Fix · anthropic 中转层（如 claude-code-hub）会在请求转 Anthropic 前
      //   注入「Kiro 开发助手」类的 system prompt，强制 Claude 拒绝跟随 user 消息里
      //   的指令，导致严格匹配「连接成功」必失败。此问题在本平台代码层改不了
      //   （中转行为），故放宽为「流非空 + 无 error event」即视为连通。
      //   注：失去"模型听话"语义对 anthropic 是已知取舍——Kiro 注入下本就测不准。
      if (provider.platform === "anthropic") {
        success = sample.length > 0;
      } else {
        success = normalizedSample.includes(TEST_EXPECTED_TEXT);
      }
    }
    if (!success && !errMsg) {
      errMsg = sample
        ? `上游未按要求回复「${TEST_EXPECTED_TEXT}」，实际返回：${sample.slice(0, 200)}`
        : "上游返回空响应";
    }
  } catch (e) {
    errMsg = maskError(e instanceof Error ? e.message : String(e));
  }

  const latency = Date.now() - startTime;

  // 写审计 + 失败/成功都记
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "test",
    resourceType: "model_provider",
    resourceId: provider.id,
    resourceName: provider.name,
    detail: {
      success,
      latency_ms: latency,
      platform: provider.platform,
      model,
      error: errMsg,
    },
  });

  if (success) {
    return NextResponse.json({
      success: true,
      latency_ms: latency,
      sample_text: sample.slice(0, 200),
    });
  }
  return NextResponse.json(
    {
      success: false,
      latency_ms: latency,
      error: errMsg ?? "未知错误",
    },
    { status: 200 } // 测试失败不算 HTTP 错误，前端按 success 字段判断
  );
}
