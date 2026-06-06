import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import {
  canReadRow,
  canWriteRow,
  sanitizeUpdatePatch,
  requireWriteAccess,
  validateTenantCode,
  scanReferences,
} from "@/lib/scoped-access";
// 6.4up v2 Phase D · D-5 · provider enforce（resourceKind=model_provider；env "model_provider" 启用；空时 no-op）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor } from "@/lib/permission-actor";

// 5.14up PR-A · 模型供应商详情 / 更新 / 删除
// 5.30up · A 半 RBAC 改造（R2 通过）：
//   GET    全 admin 角色可读，按 canReadRow 判归属；不可见 → 404 屏蔽（防 id 探测）
//   PATCH  写白名单：super + org_admin（**排 system_admin**）；canWriteRow 判归属；
//          sanitizeUpdatePatch 剥离 org_admin 的 tenant_code 字段；
//          R2 §3 embedding tenant_code 不准改成非 NULL；
//          R2 §6 显式 tenant_code 先 validateTenantCode；
//          R2 §4 转让 tenant_code 走零引用阻断（scanReferences）
//   DELETE 写白名单：super + org_admin；canWriteRow；保留现有引用阻断（与 R2 §4 共用 scanReferences）

const ALLOWED_PLATFORMS = ["openai", "coze", "dify", "yuanqi", "qingyan", "zhipu", "anthropic"];

// 5.15up API 管理模块 · category ↔ platform 映射
const CATEGORY_PLATFORMS: Record<string, string[]> = {
  // 5.30.1 · anthropic 加进 model 类目
  model: ["openai", "zhipu", "anthropic"],
  agent: ["coze", "dify", "yuanqi", "qingyan"],
  // 5.19up D1-2：知识库 embedding 配置并进 API 管理
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
  // 5.30up · 组织归属
  tenant_code: string | null;
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
  // 5.30up · 全 admin 角色可访问；按 canReadRow 判归属

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

  // 5.30up · 不可见 → 404 屏蔽（不返 403，防 id 探测枚举别 org 资源）
  if (!canReadRow(admin, data as ProviderRow)) {
    return apiError("供应商不存在", "NOT_FOUND");
  }

  // Phase D D-5 · v2 第二闸 read（env-gated；复用已 load 的 row）
  if (isResourceEnforced("model_provider") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "model_provider", "read", {
      row: { id, tenant_code: (data as ProviderRow).tenant_code },
    });
    if (err) return err;
  }

  return NextResponse.json(sanitize(data as ProviderRow));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.30up · R2 §1 双闸：写白名单 super + org_admin（**排 system_admin**）
  const gate = requireWriteAccess(admin, ["super_admin", "org_admin"]);
  if (gate) return gate;

  const { id } = await params;
  const body = await req.json();

  // 5.30up · 先加载现状 row 做 canWriteRow 判归属
  const { data: existing, error: loadErr } = await db
    .from("model_providers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[model-providers update] load failed", loadErr);
    return apiError("更新失败，请重试", "INTERNAL_ERROR");
  }
  if (!existing) return apiError("供应商不存在", "NOT_FOUND");
  const existingRow = existing as ProviderRow;
  // 不可见 → 404 屏蔽（不返 403，防 id 探测）
  if (!canReadRow(admin, existingRow)) return apiError("供应商不存在", "NOT_FOUND");
  // 可见但不可写（org_admin 看公共但写不了）→ 403
  if (!canWriteRow(admin, existingRow)) {
    return apiError("无权编辑该供应商", "FORBIDDEN");
  }

  // Phase D D-5 · v2 第二闸 update（env-gated；复用已 load 的 existingRow）
  if (isResourceEnforced("model_provider") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "model_provider", "update", { row: existingRow });
    if (err) return err;
  }

  // 5.30up · 先 sanitizeUpdatePatch 净化（org_admin 的 tenant_code 字段被剥离）
  const rawPatch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return apiError("供应商名称不能为空", "VALIDATION_ERROR");
    rawPatch.name = name;
  }
  if (typeof body.platform === "string") {
    if (!ALLOWED_PLATFORMS.includes(body.platform)) {
      return apiError(`平台类型必须是 ${ALLOWED_PLATFORMS.join(" / ")} 之一`, "VALIDATION_ERROR");
    }
    rawPatch.platform = body.platform;
  }
  if (typeof body.category === "string") {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return apiError("API 类型必须是 大模型 API / 智能体 API / Embedding API 之一", "VALIDATION_ERROR");
    }
    rawPatch.category = body.category;
  }
  if (typeof body.api_endpoint === "string") {
    const endpoint = body.api_endpoint.trim();
    if (!endpoint) return apiError("接口地址不能为空", "VALIDATION_ERROR");
    rawPatch.api_endpoint = endpoint;
  }
  // api_key 留空 = 不修改；非空 = 覆盖
  if (typeof body.api_key === "string" && body.api_key.length > 0) {
    rawPatch.api_key_enc = encrypt(body.api_key);
  }
  // 主动清空 key：单独字段 clear_api_key = true
  if (body.clear_api_key === true) {
    rawPatch.api_key_enc = "";
  }
  if (typeof body.default_model === "string") {
    rawPatch.default_model = body.default_model.trim();
  }
  if (body.default_params && typeof body.default_params === "object") {
    rawPatch.default_params = body.default_params;
  }
  if (typeof body.enabled === "boolean") {
    rawPatch.enabled = body.enabled;
  }
  // 5.30up · 显式 tenant_code（super/system 可改、含转让 / 收归公共；org_admin 由 sanitize 剥离）
  if ("tenant_code" in body) {
    const tc = body.tenant_code;
    if (tc === null || tc === "") {
      rawPatch.tenant_code = null;
    } else if (typeof tc === "string") {
      rawPatch.tenant_code = tc.trim();
    }
  }

  const patch = sanitizeUpdatePatch(admin, rawPatch);

  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }

  // platform / category 任一变更 → 校验二者匹配（避免出现 category=model 却 platform=coze）
  // 5.30up · 用上面 load 的 existingRow 替代单独 select
  if ("platform" in patch || "category" in patch) {
    const effPlatform = (patch.platform as string) ?? existingRow.platform;
    const effCategory = (patch.category as string) ?? existingRow.category ?? "model";
    if (!CATEGORY_PLATFORMS[effCategory].includes(effPlatform)) {
      return apiError(`平台「${effPlatform}」不属于${CATEGORY_LABEL[effCategory]}`, "VALIDATION_ERROR");
    }
  }

  // 5.30up · R1 §3 + R2 §3 · embedding tenant_code 不准改成非 NULL（保持平台公共基建语义）
  //   - 若 patch 改 tenant_code 且最终 category 是 embedding 且 tenant_code 非 NULL → 拒
  const effCategoryAfter =
    typeof patch.category === "string" ? patch.category : existingRow.category;
  if (effCategoryAfter === "embedding" && "tenant_code" in patch && patch.tenant_code !== null) {
    return apiError(
      "Embedding 配置必须归属平台公共（tenant_code 必须为空）",
      "VALIDATION_ERROR",
    );
  }

  // 5.30up · R2 §6 · 显式新 tenant_code 非 NULL 时校验存在性
  if ("tenant_code" in patch && typeof patch.tenant_code === "string") {
    const ok = await validateTenantCode(patch.tenant_code as string);
    if (!ok) {
      return apiError(
        `组织代码「${patch.tenant_code}」不存在或已失效，无法转让`,
        "VALIDATION_ERROR",
      );
    }
  }

  // 5.30up · R2 §4 · 转让 tenant_code（与原值不同）走零引用阻断
  //   原因：agent_drafts 无 tenant_code、agent 经 resource_permissions 间接绑组织，
  //         "引用方归属" 算法不可靠 → 改成"转让前必须零引用"硬约束（同 DELETE 口径）
  if ("tenant_code" in patch && patch.tenant_code !== existingRow.tenant_code) {
    const refs = await scanReferences("model_provider", id);
    if (refs.totalCount > 0) {
      return apiError(
        `供应商被 ${refs.byPlace.join("、")} 引用，转让前请先解绑或改为禁用`,
        "VALIDATION_ERROR",
      );
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
      tenant_code_changed:
        "tenant_code" in patch && patch.tenant_code !== existingRow.tenant_code,
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
  // 5.30up · R2 §1 双闸：写白名单 super + org_admin
  const gate = requireWriteAccess(admin, ["super_admin", "org_admin"]);
  if (gate) return gate;

  const { id } = await params;

  // 5.30up · 先加载 row 做归属判定 + 拿名字 / provider_code 用于审计
  const { data: existing, error: loadErr } = await db
    .from("model_providers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[model-providers delete] load failed", loadErr);
    return apiError("删除失败，请重试", "INTERNAL_ERROR");
  }
  if (!existing) return apiError("供应商不存在", "NOT_FOUND");
  const existingRow = existing as ProviderRow;
  if (!canReadRow(admin, existingRow)) return apiError("供应商不存在", "NOT_FOUND");
  if (!canWriteRow(admin, existingRow)) {
    return apiError("无权删除该供应商", "FORBIDDEN");
  }

  // Phase D D-5 · v2 第二闸 delete（env-gated；复用已 load 的 existingRow）
  if (isResourceEnforced("model_provider") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "model_provider", "delete", { row: existingRow });
    if (err) return err;
  }

  // 5.30up · 引用阻断：现用 R2 §4 共用 scanReferences helper（同口径覆盖 agents + drafts）
  //   注：head:true 的查询行数在响应的 `count` 字段上，**不在 data 里**；
  //   之前 inline 实现误读 data.count（恒为 null）→ 引用检查失效。scanReferences 内置正确实现。
  const refs = await scanReferences("model_provider", id);
  if (refs.totalCount > 0) {
    return apiError(
      `该供应商被 ${refs.byPlace.join("、")} 引用，请先解除引用或改为禁用`,
      "VALIDATION_ERROR",
    );
  }

  // 5.30up · DELETE 前 await resolveResourceTenantCode 缓存归属（audit.ts 警告：删完后查不到）
  const cachedTenantCode = await resolveResourceTenantCode("model_provider", id);

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
    resourceTenantCode: cachedTenantCode,
    action: "delete",
    resourceType: "model_provider",
    resourceId: id,
    resourceName: existingRow.name,
    detail: { provider_code: existingRow.provider_code },
  });

  return NextResponse.json({ ok: true });
}
