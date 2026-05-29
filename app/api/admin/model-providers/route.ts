import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";
import {
  listScopeFilter,
  resolveCreateOwnership,
  requireWriteAccess,
  validateTenantCode,
  ScopeAdminNoTenantError,
} from "@/lib/scoped-access";

// 5.14up PR-A · 模型供应商列表 + 新增
// 5.30up · A 半 RBAC 改造（R2 通过）：
//   GET    全 admin 角色可读，按 ownership 过滤（super/system 看全部；org_admin 看公共 + own）
//   POST   写白名单：super_admin + org_admin（**显式排 system_admin**，沿用 5.14up 现状）
//          · resolveCreateOwnership 注入 tenant_code（org_admin 强制本组织）
//          · R2 §3 · embedding category 强制平台公共，三种身份都拦
//          · R2 §6 · 显式 tenant_code 先 validateTenantCode 校验存在性

const ALLOWED_PLATFORMS = ["openai", "coze", "dify", "yuanqi", "qingyan", "zhipu", "anthropic"];

// 5.15up API 管理模块 · category ↔ platform 映射
//   model = 大模型 API，agent = 智能体 API
const CATEGORY_PLATFORMS: Record<string, string[]> = {
  // 5.30.1 · anthropic 加进 model 类目（Anthropic Messages API · Claude 系列）
  model: ["openai", "zhipu", "anthropic"],
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
  // 5.30up · 组织归属：NULL = 平台公共（super/system 建），非 NULL = 某 org 建
  tenant_code: string | null;
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
  // 5.19up · org_admin 也可读供应商列表（搭建器选模型供应商需要）
  // 5.30up · A 半 · 按 ownership 过滤：org_admin 仅看公共 + own；super/system 全可见

  // ?category=model|agent → 只返回该类（API 管理两 tab 用）；不带则全返
  const category = req.nextUrl.searchParams.get("category");
  let query = db
    .from("model_providers")
    .select("*")
    .order("created_at", { ascending: false });
  if (category && VALID_CATEGORIES.includes(category)) {
    query = query.eq("category", category);
  }
  // 5.30up · 接 listScopeFilter：org_admin 自动加 tenant_code 过滤；super/system null 不动
  const scope = listScopeFilter(admin);
  if (scope) query = query.or(scope);

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
  // 5.30up · R2 §1 双闸：写白名单 super + org_admin（**不放 system_admin**）+ tenantCode 兜底
  const gate = requireWriteAccess(admin, ["super_admin", "org_admin"]);
  if (gate) return gate;

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
  // 5.30up · 显式 tenant_code（super/system 才会传；org_admin 路径强制走 admin.tenantCode）
  const rawTenantCode =
    typeof body.tenant_code === "string" && body.tenant_code.trim() !== ""
      ? body.tenant_code.trim()
      : null;

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

  // 5.30up · R1 §3 + R2 §3 · embedding 强制平台公共（基础设施 = 全平台共用 + 维度一致性）
  //   - org_admin 创建 embedding → 422
  //   - super/system 显式带 tenant_code 创建 embedding → 422（不能赋给某 org）
  if (category === "embedding") {
    if (admin.role === "org_admin") {
      return apiError(
        "Embedding 配置为平台基础设施，组织管理员无法创建",
        "FORBIDDEN",
      );
    }
    if (rawTenantCode !== null) {
      return apiError(
        "Embedding 配置必须归属平台公共（tenant_code 必须为空）",
        "VALIDATION_ERROR",
      );
    }
  }

  // 5.30up · R2 §6 · super/system 显式传 tenant_code 时先校验存在性，防孤儿资源
  if ((admin.role === "super_admin" || admin.role === "system_admin") && rawTenantCode !== null) {
    const ok = await validateTenantCode(rawTenantCode);
    if (!ok) {
      return apiError(
        `组织代码「${rawTenantCode}」不存在或已失效，无法创建归属此组织的供应商`,
        "VALIDATION_ERROR",
      );
    }
  }

  // 5.30up · 计算 ownership：org_admin 强制本组织；super/system 沿用 payload
  let ownership: { tenant_code: string | null };
  try {
    ownership = resolveCreateOwnership(admin, { tenant_code: rawTenantCode });
  } catch (e) {
    if (e instanceof ScopeAdminNoTenantError) {
      return apiError("组织管理员未绑定组织，无法创建供应商", "FORBIDDEN");
    }
    throw e;
  }

  // 5.30up · R2 §6 · org_admin 路径再校验 admin.tenantCode 在 tenants 表里
  //   防 admin 绑定的 org 已被删除却仍能创建归属此 org 的资源
  if (admin.role === "org_admin" && ownership.tenant_code) {
    const ok = await validateTenantCode(ownership.tenant_code);
    if (!ok) {
      return apiError(
        "您所属的组织不存在或已失效，请联系平台管理员",
        "FORBIDDEN",
      );
    }
  }

  // 重名校验（依赖 UNIQUE 约束，但提前给友好错误）
  // 5.30up · provider_code 仍是全局 UNIQUE（方案 R2 §3 决定），跨 org 撞名按现有逻辑友好报错
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
      tenant_code: ownership.tenant_code,
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
    detail: {
      provider_code,
      platform,
      category,
      default_model,
      tenant_code: ownership.tenant_code,
    },
  });

  return NextResponse.json(sanitize(data as ProviderRow));
}
