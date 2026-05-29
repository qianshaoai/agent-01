import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canReadRow } from "@/lib/scoped-access";

// 5.14up PR-B · 智能体草稿详情 / 保存 / 删除
// 权限：super_admin + system_admin 可所有；org_admin 不可
//
// 5.30up · R1 §2 草稿链路 RBAC 收口：
//   PATCH 时若入参带 provider_id / builder_config.knowledge_base_ids，全部 canReadRow，
//   任一不可见 → 422（硬阻断，与 POST 同口径）

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

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
  // 5.19up · org_admin 只能查看自己创建的草稿
  if (admin.role === "org_admin" && (data as { created_by?: string }).created_by !== admin.adminId) {
    return apiError("无权查看该草稿", "FORBIDDEN");
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  // 5.19up · org_admin 只能编辑自己创建的草稿
  if (admin.role === "org_admin") {
    const { data: own } = await db
      .from("agent_drafts").select("created_by").eq("id", id).maybeSingle();
    if (!own) return apiError("草稿不存在", "NOT_FOUND");
    if (own.created_by !== admin.adminId) return apiError("无权编辑该草稿", "FORBIDDEN");
  }
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

  // 5.30up · R1 §2 · 草稿引用资源 RBAC 校验（硬阻断口径，与 POST 同）
  //   仅当 patch 实际带 provider_id / builder_config 时才校验，避免无谓 DB 查询
  if (typeof patch.provider_id === "string" && patch.provider_id) {
    const { data: prov } = await db
      .from("model_providers")
      .select("id, tenant_code")
      .eq("id", patch.provider_id as string)
      .maybeSingle();
    if (!prov) return apiError("引用的供应商不存在", "VALIDATION_ERROR");
    if (!canReadRow(admin, prov as { tenant_code: string | null })) {
      return apiError("引用的供应商不存在或无权访问", "VALIDATION_ERROR");
    }
  }
  if (patch.builder_config && typeof patch.builder_config === "object") {
    const kbIdsRaw = (patch.builder_config as Record<string, unknown>).knowledge_base_ids;
    const kbIds: string[] = Array.isArray(kbIdsRaw)
      ? (kbIdsRaw as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
    if (kbIds.length > 0) {
      const { data: kbRows } = await db
        .from("knowledge_bases")
        .select("id, tenant_code")
        .in("id", kbIds);
      const rows = (kbRows ?? []) as { id: string; tenant_code: string | null }[];
      const visibleIds = new Set(rows.filter((r) => canReadRow(admin, r)).map((r) => r.id));
      const invisible = kbIds.filter((kid) => !visibleIds.has(kid));
      if (invisible.length > 0) {
        return apiError(
          `引用的知识库${invisible.length} 个不存在或无权访问（${invisible.slice(0, 3).join("、")}${invisible.length > 3 ? "…" : ""}）`,
          "VALIDATION_ERROR",
        );
      }
    }
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

  const { id } = await params;

  // 取一份名字 + status 用于审计与判断
  // 5.15up bugfix · 加 error 检查；之前 fetch failed 也是 data=null，被误报为"草稿不存在"
  const { data: existing, error: loadErr } = await db
    .from("agent_drafts")
    .select("name, status, published_agent_id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[agent-drafts delete load]", loadErr);
    return apiError("加载草稿失败，请稍后重试", "INTERNAL_ERROR");
  }
  if (!existing) return apiError("草稿不存在", "NOT_FOUND");
  // 5.19up · org_admin 只能删除自己创建的草稿
  if (admin.role === "org_admin" && existing.created_by !== admin.adminId) {
    return apiError("无权删除该草稿", "FORBIDDEN");
  }

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
