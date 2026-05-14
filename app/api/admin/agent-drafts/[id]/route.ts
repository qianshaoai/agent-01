import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-B · 智能体草稿详情 / 保存 / 删除
// 权限：super_admin + system_admin 可所有；org_admin 不可

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权查看智能体草稿", "FORBIDDEN");
  }

  const { id } = await params;
  const { data, error } = await db
    .from("agent_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[agent-drafts get]", error);
    return apiError("获取详情失败", "INTERNAL_ERROR");
  }
  if (!data) return apiError("草稿不存在", "NOT_FOUND");

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权编辑智能体草稿", "FORBIDDEN");
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") patch.name = body.name.trim() || "未命名智能体";
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.category_ids)) patch.category_ids = body.category_ids;
  if (typeof body.provider_id === "string" || body.provider_id === null) {
    patch.provider_id = body.provider_id || null;
  }
  if (body.agent_type === "chat" || body.agent_type === "external") {
    patch.agent_type = body.agent_type;
  }
  if (typeof body.external_url === "string") patch.external_url = body.external_url;
  if (body.builder_config && typeof body.builder_config === "object") {
    patch.builder_config = body.builder_config;
  }
  if (body.model_params && typeof body.model_params === "object") {
    patch.model_params = body.model_params;
  }
  if (body.visibility_config && typeof body.visibility_config === "object") {
    patch.visibility_config = body.visibility_config;
  }
  // status 只允许小幅流转：draft ↔ testing；published 和 archived 由 publish/delete 流程独立处理
  if (body.status === "draft" || body.status === "testing") {
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }

  patch.updated_by = admin.adminId;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("agent_drafts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[agent-drafts update]", error);
    return apiError("保存失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "agent_draft",
    resourceId: id,
    resourceName: (data as { name: string }).name,
    detail: {
      fields: Object.keys(patch).filter((k) => k !== "updated_at" && k !== "updated_by"),
    },
  });

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return apiError("无权删除智能体草稿", "FORBIDDEN");
  }

  const { id } = await params;

  // 取一份名字 + status 用于审计与判断
  const { data: existing } = await db
    .from("agent_drafts")
    .select("name, status, published_agent_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiError("草稿不存在", "NOT_FOUND");

  // 已发布的草稿：软删（status → archived），保留 published_agent_id 反查关系
  // 未发布的：硬删
  if (existing.status === "published" && existing.published_agent_id) {
    const { error } = await db
      .from("agent_drafts")
      .update({ status: "archived", updated_by: admin.adminId, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[agent-drafts soft-delete]", error);
      return apiError("归档失败", "INTERNAL_ERROR");
    }
  } else {
    const { error } = await db.from("agent_drafts").delete().eq("id", id);
    if (error) {
      console.error("[agent-drafts delete]", error);
      return apiError("删除失败", "INTERNAL_ERROR");
    }
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "delete",
    resourceType: "agent_draft",
    resourceId: id,
    resourceName: existing.name,
    detail: { status_was: existing.status, archived: existing.status === "published" },
  });

  return NextResponse.json({ ok: true });
}
