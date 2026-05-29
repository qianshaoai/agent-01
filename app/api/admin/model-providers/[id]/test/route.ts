import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { streamChat, ChatMessage } from "@/lib/adapters";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-A · 模型供应商连通性测试
// 权限：super_admin + system_admin 都可测试（不返回 key 明文）
//
// 行为：用最小 messages 发一次流式对话，限制 10 秒超时，
// 返回 { success, latency_ms, sample_text? , error? }，错误信息脱敏（不带 Authorization / key）

const TIMEOUT_MS = 10_000;
const TEST_PROMPT = '请只回复"连接成功"四个字。';

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
};

function maskError(msg: string): string {
  // 脱敏：去掉可能的 Bearer xxx、Authorization、key 明文
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-+/=.]+/gi, "Bearer ***")
    .replace(/Authorization:\s*[^\s,]+/gi, "Authorization: ***")
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9_\-+/=.]+/gi, "$1***")
    .slice(0, 500); // 截断超长 stack trace
}

// 5.29up R5 Fix 4 · 从 chat completions endpoint 推导 OpenAI 兼容的 /models 列表 URL。
//   常见 endpoint 形式：
//     - https://api.deepseek.com/v1/chat/completions      → https://api.deepseek.com/v1/models
//     - https://api.openai.com/v1/chat/completions        → https://api.openai.com/v1/models
//     - https://relay.example.com/v1/chat/completions     → https://relay.example.com/v1/models
//   非 chat/completions 结尾的（罕见）返 null，让调用方降级。
function deriveModelsListUrl(chatEndpoint: string): string | null {
  try {
    const url = new URL(chatEndpoint);
    if (!url.pathname.endsWith("/chat/completions")) return null;
    url.pathname = url.pathname.replace(/\/chat\/completions$/, "/models");
    return url.toString();
  } catch {
    return null;
  }
}

// 5.29up R5 Fix 4 · GET {baseUrl}/models 验证指定 model 是否在供应商的模型列表里。
//   返回值：
//     - "found"     → 在列表里，可继续走 chat 探针
//     - "not-found" → 不在列表里，调用方应直接返回 ✗
//     - "unknown"   → /models 不可访问（404 / 网络错误 / 解析失败），降级走 chat 探针
const MODELS_LIST_TIMEOUT_MS = 5000;
async function checkModelInList(
  modelsListUrl: string,
  apiKey: string,
  targetModel: string,
): Promise<"found" | "not-found" | "unknown"> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), MODELS_LIST_TIMEOUT_MS);
  try {
    const res = await fetch(modelsListUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    });
    if (!res.ok) return "unknown"; // 404 / 403 / 5xx 都降级，不一棒子打死
    const data = await res.json().catch(() => null);
    // OpenAI 标准响应：{ "data": [{ "id": "gpt-4o-mini", ... }, ...] }
    const list = Array.isArray((data as { data?: unknown[] })?.data)
      ? ((data as { data: { id?: string }[] }).data)
      : null;
    if (!list) return "unknown";
    const ids = new Set(list.map((m) => m?.id).filter((x): x is string => typeof x === "string"));
    return ids.has(targetModel) ? "found" : "not-found";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(t);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权测试模型供应商", "FORBIDDEN");
  }

  const { id } = await params;
  // 5.29up Phase 2 · 可选 ?model=xxx 覆盖：搭建器里 admin 手填的自定义模型名
  //   通过这个 query 参数验证是否被供应商识别。不传则仍走 provider 默认模型（API
  //   管理页"测试"按钮行为完全不变）。简单 sanitize：截 100 字符 + trim，避免极端
  //   输入塞进上游请求。
  const overrideModelRaw = req.nextUrl.searchParams.get("model");
  const overrideModel = overrideModelRaw ? overrideModelRaw.trim().slice(0, 100) : "";
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
  // 5.29up Phase 2 · ?model= 优先级最高（用于搭建器自定义模型探针）
  const model = overrideModel || (provider.default_params?.model as string) || provider.default_model || "";

  // 5.29up R5 Fix 4 · OpenAI 兼容平台 + 指定了 ?model= 时，先 GET {baseUrl}/models
  //   验证模型在供应商的 model list 里。解决"第三方中转 silently 回落到默认模型 →
  //   填啥 model 都返回 200 → 探针误报成功"的问题（用户实测：填 got-9.0 也 ✓）。
  //
  //   策略：
  //   - 只对 platform=openai 且 admin 指定了 ?model= 的场景启用（API 管理页"测试"
  //     按钮不传 model，行为不变）
  //   - GET /models 200 + JSON 解析 + 找到 model → ✓ 通过验证，继续走 chat 探针
  //   - GET /models 200 + 找不到 model → ✗ 直接报 "供应商不识别此模型"
  //   - GET /models 404 / 网络错误 → 降级走 chat 探针（兼容不暴露 /models 的中转）
  if (overrideModel && provider.platform === "openai") {
    const baseUrl = deriveModelsListUrl(provider.api_endpoint);
    if (baseUrl) {
      const found = await checkModelInList(baseUrl, apiKey, overrideModel);
      if (found === "not-found") {
        return NextResponse.json(
          {
            success: false,
            latency_ms: Date.now() - startTime,
            error: `供应商接口里不存在模型「${overrideModel}」（已通过 ${baseUrl} 验证）`,
          },
          { status: 200 },
        );
      }
      // found === "found" 或 "unknown"（/models 不可用 → 降级）→ 继续走 chat 探针
    }
  }

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
    if (!errMsg) success = sample.length > 0;
    if (!success && !errMsg) errMsg = "上游返回空响应";
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
