import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-B · 复制草稿
// 复制所有字段，但：
//   - name 后缀加 "（副本）"
//   - status 重置为 'draft'
//   - published_agent_id 置 null（副本是独立的）
//   - source_agent_id 沿用原值
//   - created_by / updated_by 设为当前管理员

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
  if (admin.role === "org_admin") {
    return apiError("无权复制智能体草稿", "FORBIDDEN");
  }

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

  const source = src as DraftRow;

  const payload = {
    name: `${source.name}（副本）`,
    description: source.description,
    category_ids: source.category_ids,
    provider_id: source.provider_id,
    agent_type: source.agent_type,
    external_url: source.external_url,
    builder_config: source.builder_config,
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
    detail: { duplicated_from: id },
  });

  return NextResponse.json(data);
}
