import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canReadRow } from "@/lib/scoped-access";

// 5.14up PR-B · 复制草稿
// 复制所有字段，但：
//   - name 后缀加 "（副本）"
//   - status 重置为 'draft'
//   - published_agent_id 置 null（副本是独立的）
//   - source_agent_id 沿用原值
//   - created_by / updated_by 设为当前管理员
//
// 5.30up · R1 §2 · 草稿引用资源 RBAC 校验（**软降级口径**）
//   复制是"拿别人的模板改造"高频路径（如复制平台 demo agent），硬阻断会破坏体验。
//   口径：
//   - 源 provider_id 当前 admin 不可见 → 设为 NULL（admin 后续自己选）
//   - 源 KB ids 当前 admin 不可见 → 从 array 移除
//   - 返回 strippedIds: { provider, kbs } 让前端 toast 提示哪些被剥离

type DraftRow = {
  id: string;
  name: string;
  description: string;
  category_ids: unknown[];
  provider_id: string | null;
  agent_type: string;
  external_url: string;
  builder_config: Record<string, unknown>;
  model_params: Record<string, unknown>;
  visibility_config: Record<string, unknown>;
  source_agent_id: string | null;
};

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const { data: src, error: loadError } = await db
    .from("agent_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("[agent-drafts duplicate load]", loadError);
    return apiError("加载源草稿失败", "INTERNAL_ERROR");
  }
  if (!src) return apiError("源草稿不存在", "NOT_FOUND");
  // 5.19up · org_admin 只能复制自己创建的草稿
  if (admin.role === "org_admin" && (src as { created_by?: string }).created_by !== admin.adminId) {
    return apiError("无权复制该草稿", "FORBIDDEN");
  }

  const source = src as DraftRow;

  // 5.30up · R1 §2 软降级：源 provider_id / KB ids 按当前 admin 视角校验，不可见的剥离
  let effProviderId = source.provider_id;
  let strippedProvider: string | null = null;
  if (effProviderId) {
    const { data: prov } = await db
      .from("model_providers")
      .select("id, tenant_code")
      .eq("id", effProviderId)
      .maybeSingle();
    if (!prov || !canReadRow(admin, prov as { tenant_code: string | null })) {
      strippedProvider = effProviderId;
      effProviderId = null;
    }
  }

  const srcBuilderConfig = (source.builder_config ?? {}) as Record<string, unknown>;
  const srcKbIdsRaw = srcBuilderConfig.knowledge_base_ids;
  const srcKbIds: string[] = Array.isArray(srcKbIdsRaw)
    ? (srcKbIdsRaw as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  let visibleKbIds = srcKbIds;
  const strippedKbs: string[] = [];
  if (srcKbIds.length > 0) {
    const { data: kbRows } = await db
      .from("knowledge_bases")
      .select("id, tenant_code")
      .in("id", srcKbIds);
    const rows = (kbRows ?? []) as { id: string; tenant_code: string | null }[];
    const visibleSet = new Set(rows.filter((r) => canReadRow(admin, r)).map((r) => r.id));
    visibleKbIds = srcKbIds.filter((kid) => visibleSet.has(kid));
    for (const kid of srcKbIds) if (!visibleSet.has(kid)) strippedKbs.push(kid);
  }

  // 重组 builder_config：原配置不动，只覆盖 knowledge_base_ids（可能被过滤）
  const effBuilderConfig: Record<string, unknown> = {
    ...srcBuilderConfig,
    ...(srcKbIds.length > 0 ? { knowledge_base_ids: visibleKbIds } : {}),
  };

  const payload = {
    name: `${source.name}（副本）`,
    description: source.description,
    category_ids: source.category_ids,
    provider_id: effProviderId,
    agent_type: source.agent_type,
    external_url: source.external_url,
    builder_config: effBuilderConfig,
    model_params: source.model_params,
    visibility_config: source.visibility_config,
    status: "draft" as const,
    source_agent_id: source.source_agent_id,
    published_agent_id: null,
    created_by: admin.adminId,
    updated_by: admin.adminId,
  };

  const { data, error } = await db
    .from("agent_drafts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("[agent-drafts duplicate insert]", error);
    return apiError("复制草稿失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "create",
    resourceType: "agent_draft",
    resourceId: data.id,
    resourceName: payload.name,
    detail: {
      duplicated_from: id,
      stripped_provider: strippedProvider,
      stripped_kbs: strippedKbs,
    },
  });

  // 5.30up · 返回 strippedIds 供前端 toast 提示
  return NextResponse.json({
    ...data,
    strippedIds: { provider: strippedProvider, kbs: strippedKbs },
  });
}
