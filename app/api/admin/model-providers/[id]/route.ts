import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-A · 模型供应商详情 / 更新 / 删除
// 权限：super_admin 可所有；system_admin 仅 GET；org_admin 无权

const ALLOWED_PLATFORMS = ["openai", "coze", "dify", "yuanqi", "qingyan", "zhipu"];

// 5.15up API 管理模块 · category ↔ platform 映射
const CATEGORY_PLATFORMS: Record<string, string[]> = {
  model: ["openai", "zhipu"],
  agent: ["coze", "dify", "yuanqi", "qingyan"],
};
const CATEGORY_LABEL: Record<string, string> = { model: "大模型 API", agent: "智能体 API" };

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
  const { api_key_enc, ...rest } = row;
  return { ...rest, has_api_key: Boolean(api_key_enc) };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权查看模型供应商", "FORBIDDEN");
  }

  const { id } = await params;
  const { data, error } = await db
    .from("model_providers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[model-providers get]", error);
    return apiError("获取详情失败", "INTERNAL_ERROR");
  }
  if (!data) return apiError("供应商不存在", "NOT_FOUND");

  return NextResponse.json(sanitize(data as ProviderRow));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可编辑模型供应商", "FORBIDDEN");
  }

  const { id } = await params;
  const body = await req.json();

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return apiError("供应商名称不能为空", "VALIDATION_ERROR");
    patch.name = name;
  }
  if (typeof body.platform === "string") {
    if (!ALLOWED_PLATFORMS.includes(body.platform)) {
      return apiError(`平台类型必须是 ${ALLOWED_PLATFORMS.join(" / ")} 之一`, "VALIDATION_ERROR");
    }
    patch.platform = body.platform;
  }
  if (typeof body.category === "string") {
    if (body.category !== "model" && body.category !== "agent") {
      return apiError("API 类型必须是 大模型 API / 智能体 API 之一", "VALIDATION_ERROR");
    }
    patch.category = body.category;
  }
  if (typeof body.api_endpoint === "string") {
    const endpoint = body.api_endpoint.trim();
    if (!endpoint) return apiError("接口地址不能为空", "VALIDATION_ERROR");
    patch.api_endpoint = endpoint;
  }
  // api_key 留空 = 不修改；非空 = 覆盖
  if (typeof body.api_key === "string" && body.api_key.length > 0) {
    patch.api_key_enc = encrypt(body.api_key);
  }
  // 主动清空 key：单独字段 clear_api_key = true
  if (body.clear_api_key === true) {
    patch.api_key_enc = "";
  }
  if (typeof body.default_model === "string") {
    patch.default_model = body.default_model.trim();
  }
  if (body.default_params && typeof body.default_params === "object") {
    patch.default_params = body.default_params;
  }
  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }

  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }

  // platform / category 任一变更 → 校验二者匹配（避免出现 category=model 却 platform=coze）
  if ("platform" in patch || "category" in patch) {
    const { data: cur, error: curErr } = await db
      .from("model_providers")
      .select("platform, category")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      console.error("[model-providers update] load current failed", curErr);
      return apiError("更新失败，请重试", "INTERNAL_ERROR");
    }
    if (!cur) return apiError("供应商不存在", "NOT_FOUND");
    const effPlatform = (patch.platform as string) ?? cur.platform;
    const effCategory = (patch.category as string) ?? cur.category ?? "model";
    if (!CATEGORY_PLATFORMS[effCategory].includes(effPlatform)) {
      return apiError(`平台「${effPlatform}」不属于${CATEGORY_LABEL[effCategory]}`, "VALIDATION_ERROR");
    }
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("model_providers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[model-providers update]", error);
    return apiError("更新失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "model_provider",
    resourceId: id,
    resourceName: (data as ProviderRow).name,
    detail: {
      fields: Object.keys(patch).filter((k) => k !== "updated_at" && k !== "api_key_enc"),
      key_changed: "api_key_enc" in patch,
    },
  });

  return NextResponse.json(sanitize(data as ProviderRow));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可删除模型供应商", "FORBIDDEN");
  }

  const { id } = await params;

  // 引用扫描：被 agents.provider_id / agent_drafts.provider_id 引用时禁止硬删。
  // 注意：head:true 的查询，行数在响应的 `count` 字段上，**不在 data 里**；
  // 之前误读 data.count（恒为 null）→ 引用检查失效，被引用的 provider 会被硬删，
  // 外键 ON DELETE SET NULL 把 agent 静默解绑、回落旧 key，绕过集中管理。
  const { count: agentRefCount, error: agentRefErr } = await db
    .from("agents")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", id);
  if (agentRefErr) {
    console.error("[model-providers delete] 引用检查(agents) 失败", agentRefErr);
    return apiError("引用检查失败，请重试", "INTERNAL_ERROR");
  }
  if (agentRefCount && agentRefCount > 0) {
    return apiError(
      `该供应商被 ${agentRefCount} 个智能体引用，请先解除引用或改为禁用`,
      "VALIDATION_ERROR"
    );
  }
  const { count: draftRefCount, error: draftRefErr } = await db
    .from("agent_drafts")
    .select("id", { count: "exact", head: true })
    .eq("provider_id", id);
  if (draftRefErr) {
    console.error("[model-providers delete] 引用检查(agent_drafts) 失败", draftRefErr);
    return apiError("引用检查失败，请重试", "INTERNAL_ERROR");
  }
  if (draftRefCount && draftRefCount > 0) {
    return apiError(
      `该供应商被 ${draftRefCount} 个智能体草稿引用，请先解除引用或改为禁用`,
      "VALIDATION_ERROR"
    );
  }

  // 取一份名字用于审计
  const { data: existing } = await db
    .from("model_providers")
    .select("name, provider_code")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiError("供应商不存在", "NOT_FOUND");

  const { error } = await db.from("model_providers").delete().eq("id", id);
  if (error) {
    console.error("[model-providers delete]", error);
    return apiError("删除失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "delete",
    resourceType: "model_provider",
    resourceId: id,
    resourceName: existing.name,
    detail: { provider_code: existing.provider_code },
  });

  return NextResponse.json({ ok: true });
}
