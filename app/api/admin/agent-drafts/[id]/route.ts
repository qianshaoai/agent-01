import { apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import type { AdminPayload } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import { canReadRow } from "@/lib/scoped-access";
import { NextRequest, NextResponse } from "next/server";

type TenantOwnedRow = { id: string; tenant_code: string | null };

async function canReadTenantOwned(
  ctx: AdminActorContext,
  resourceKind: "model_provider" | "knowledge_base",
  row: TenantOwnedRow,
) {
  if (ctx.isCustomAdmin) {
    return !(await requireAccess(ctx.actor, resourceKind, "read", { row }));
  }
  return canReadRow(ctx.access as AdminPayload, row);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

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

  if (
    ctx.role === "org_admin" &&
    !ctx.actor.v2Loaded &&
    (data as { created_by?: string }).created_by !== ctx.adminId
  ) {
    return apiError("无权查看该草稿", "FORBIDDEN");
  }

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "agent_draft", "read", { id });
    if (err) return err;
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role === "org_admin" && !ctx.actor.v2Loaded) {
    const { data: own } = await db
      .from("agent_drafts")
      .select("created_by")
      .eq("id", id)
      .maybeSingle();
    if (!own) return apiError("草稿不存在", "NOT_FOUND");
    if (own.created_by !== ctx.adminId) return apiError("无权编辑该草稿", "FORBIDDEN");
  }

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "agent_draft", "update", { id });
    if (err) return err;
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") patch.name = body.name.trim() || "未命名智能体";
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.category_ids)) patch.category_ids = body.category_ids;
  if (typeof body.provider_id === "string" || body.provider_id === null) {
    patch.provider_id = body.provider_id || null;
  }
  if (body.agent_type === "chat" || body.agent_type === "external") patch.agent_type = body.agent_type;
  if (typeof body.external_url === "string") patch.external_url = body.external_url;
  if (body.builder_config && typeof body.builder_config === "object") patch.builder_config = body.builder_config;
  if (body.model_params && typeof body.model_params === "object") patch.model_params = body.model_params;
  if (body.visibility_config && typeof body.visibility_config === "object") {
    patch.visibility_config = body.visibility_config;
  }
  if (body.status === "draft" || body.status === "testing") patch.status = body.status;

  if (typeof patch.provider_id === "string" && patch.provider_id) {
    const { data: prov } = await db
      .from("model_providers")
      .select("id, tenant_code")
      .eq("id", patch.provider_id)
      .maybeSingle();
    if (!prov) return apiError("引用的供应商不存在", "VALIDATION_ERROR");
    if (!(await canReadTenantOwned(ctx, "model_provider", prov as TenantOwnedRow))) {
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
      const rows = (kbRows ?? []) as TenantOwnedRow[];
      const visibleIds = new Set<string>();
      for (const row of rows) {
        if (await canReadTenantOwned(ctx, "knowledge_base", row)) visibleIds.add(row.id);
      }
      const invisible = kbIds.filter((kid) => !visibleIds.has(kid));
      if (invisible.length > 0) {
        return apiError(
          `引用的知识库${invisible.length} 个不存在或无权访问（${invisible.slice(0, 3).join("、")}${invisible.length > 3 ? "..." : ""}）`,
          "VALIDATION_ERROR",
        );
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }

  patch.updated_by = ctx.adminId;
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
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
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
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
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
  if (ctx.role === "org_admin" && !ctx.actor.v2Loaded && existing.created_by !== ctx.adminId) {
    return apiError("无权删除该草稿", "FORBIDDEN");
  }

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "agent_draft", "delete", { id });
    if (err) return err;
  }

  if (existing.status === "published" && existing.published_agent_id) {
    const { error } = await db
      .from("agent_drafts")
      .update({ status: "archived", updated_by: ctx.adminId, updated_at: new Date().toISOString() })
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
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "delete",
    resourceType: "agent_draft",
    resourceId: id,
    resourceName: existing.name,
    detail: { status_was: existing.status, archived: existing.status === "published" },
  });

  return NextResponse.json({ ok: true });
}
