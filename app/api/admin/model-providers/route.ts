import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-A · 模型供应商列表 + 新增
// 权限：
//   GET    super_admin + system_admin 可读（system_admin 看不到 api_key 明文 → 列表本来就只返 has_api_key）
//   POST   仅 super_admin 可创建

const ALLOWED_PLATFORMS = ["openai", "coze", "dify", "yuanqi", "qingyan", "zhipu"];

// 5.15up API 管理模块 · category ↔ platform 映射
//   model = 大模型 API，agent = 智能体 API
const CATEGORY_PLATFORMS: Record<string, string[]> = {
  model: ["openai", "zhipu"],
  agent: ["coze", "dify", "yuanqi", "qingyan"],
  // 5.19up D1-2：知识库 embedding 配置并进 API 管理（lib/kb/embed.ts 从这里取配置）
  embedding: ["zhipu"],
};
const CATEGORY_LABEL: Record<string, string> = {
  model: "大模型 API",
  agent: "智能体 API",
  embedding: "Embedding API",
};
const VALID_CATEGORIES = ["model", "agent", "embedding"];

type ProviderRow = {
  id: string;
  provider_code: string;
  name: string;
  platform: string;
  category: string;
  api_endpoint: string;
  api_key_enc: string;
  default_model: string;
  default_params: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

function sanitize(row: ProviderRow) {
  // 列表/详情都不返回 api_key_enc 明文 / 密文，只返 has_api_key
  const { api_key_enc, ...rest } = row;
  return { ...rest, has_api_key: Boolean(api_key_enc) };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.19up · org_admin 也可读供应商列表（搭建器选模型供应商需要）；
  //   返回经 sanitize 脱敏、不含 key。创建 / 改 / 删仍限超管。

  // ?category=model|agent → 只返回该类（API 管理两 tab 用）；不带则全返
  const category = req.nextUrl.searchParams.get("category");
  let query = db
    .from("model_providers")
    .select("*")
    .order("created_at", { ascending: false });
  if (category && VALID_CATEGORIES.includes(category)) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[model-providers list]", error);
    return apiError("获取列表失败", "INTERNAL_ERROR");
  }

  return NextResponse.json({
    data: ((data ?? []) as ProviderRow[]).map(sanitize),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可创建模型供应商", "FORBIDDEN");
  }

  const body = await req.json();
  const provider_code = String(body.provider_code ?? "").trim();
  const name = String(body.name ?? "").trim();
  const platform = String(body.platform ?? "").trim();
  const category = String(body.category ?? "model").trim();
  const api_endpoint = String(body.api_endpoint ?? "").trim();
  const api_key = String(body.api_key ?? "");
  const default_model = String(body.default_model ?? "").trim();
  const default_params = body.default_params && typeof body.default_params === "object"
    ? body.default_params
    : {};
  const enabled = body.enabled === false ? false : true;

  if (!provider_code) return apiError("供应商编号不能为空", "VALIDATION_ERROR");
  if (!/^[a-zA-Z0-9_-]+$/.test(provider_code)) {
    return apiError("供应商编号只允许英文字母、数字、下划线、短横线", "VALIDATION_ERROR");
  }
  if (!name) return apiError("供应商名称不能为空", "VALIDATION_ERROR");
  if (!VALID_CATEGORIES.includes(category)) {
    return apiError("API 类型必须是 大模型 API / 智能体 API / Embedding API 之一", "VALIDATION_ERROR");
  }
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    return apiError(`平台类型必须是 ${ALLOWED_PLATFORMS.join(" / ")} 之一`, "VALIDATION_ERROR");
  }
  if (!CATEGORY_PLATFORMS[category].includes(platform)) {
    return apiError(`平台「${platform}」不属于${CATEGORY_LABEL[category]}`, "VALIDATION_ERROR");
  }
  if (!api_endpoint) return apiError("接口地址不能为空", "VALIDATION_ERROR");
  if (!api_key) return apiError("API Key 不能为空", "VALIDATION_ERROR");

  // 重名校验（依赖 UNIQUE 约束，但提前给友好错误）
  const { data: existing } = await db
    .from("model_providers")
    .select("id")
    .eq("provider_code", provider_code)
    .maybeSingle();
  if (existing) {
    return apiError(`供应商编号 ${provider_code} 已存在`, "VALIDATION_ERROR");
  }

  const { data, error } = await db
    .from("model_providers")
    .insert({
      provider_code,
      name,
      platform,
      category,
      api_endpoint,
      api_key_enc: encrypt(api_key),
      default_model,
      default_params,
      enabled,
      created_by: admin.adminId,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[model-providers create]", error);
    return apiError("创建失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "create",
    resourceType: "model_provider",
    resourceId: data.id,
    resourceName: name,
    detail: { provider_code, platform, category, default_model },
  });

  return NextResponse.json(sanitize(data as ProviderRow));
}
