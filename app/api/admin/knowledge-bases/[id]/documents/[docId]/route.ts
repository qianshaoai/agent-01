import { apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import type { AdminPayload } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { requireCreatorHierarchy } from "@/lib/creator-hierarchy";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET } from "@/lib/kb/ingest";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import {
  canWriteRow,
  requireWriteAccess,
  validateTenantCode,
} from "@/lib/scoped-access";
import { NextRequest, NextResponse, after } from "next/server";

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, total_chunks, char_count, error_msg, created_at";

async function loadWritableKb(
  id: string,
  ctx: AdminActorContext,
) {
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code, created_by_role")
    .eq("id", id)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb document] parent kb query failed", kbErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  if (!ctx.isCustomAdmin && !canWriteRow(ctx.access as AdminPayload, kb)) {
    return apiError("知识库不存在", "NOT_FOUND");
  }
  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "knowledge_base", "update", { row: kb });
    if (accessErr) return accessErr;
  }
  const hierarchyErr = requireCreatorHierarchy(ctx, "knowledge_base", kb.created_by_role);
  if (hierarchyErr) return hierarchyErr;

  if ((ctx.role === "org_admin" || ctx.isCustomAdmin) && ctx.tenantCode) {
    const ok = await validateTenantCode(ctx.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }
  return kb;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (!ctx.isCustomAdmin) {
    const gate = requireWriteAccess(ctx.access as AdminPayload, [...KB_WRITE_ROLES]);
    if (gate) return gate;
  }

  const { id, docId } = await params;
  const kb = await loadWritableKb(id, ctx);
  if (kb instanceof Response) return kb;

  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id, filename, storage_path")
    .eq("id", docId)
    .eq("kb_id", id)
    .maybeSingle();
  if (error) {
    console.error("[kb document delete] query failed", error);
    return apiError("加载文档失败，请重试", "INTERNAL_ERROR");
  }
  if (!doc) return apiError("文档不存在", "NOT_FOUND");

  const { error: delErr } = await db
    .from("kb_documents")
    .delete()
    .eq("id", docId)
    .eq("kb_id", id);
  if (delErr) {
    console.error("[kb document delete]", delErr);
    return apiError("删除文档失败", "INTERNAL_ERROR");
  }
  if (doc.storage_path) {
    const { error: rmErr } = await db.storage
      .from(KB_STORAGE_BUCKET)
      .remove([doc.storage_path]);
    if (rmErr) console.error("[kb document delete] remove storage failed", rmErr);
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code ?? null,
    action: "delete",
    resourceType: "knowledge_base",
    resourceId: id,
    detail: { document_id: docId, filename: doc.filename },
  });

  return NextResponse.json({ ok: true });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (!ctx.isCustomAdmin) {
    const gate = requireWriteAccess(ctx.access as AdminPayload, [...KB_WRITE_ROLES]);
    if (gate) return gate;
  }

  const { id, docId } = await params;
  const kb = await loadWritableKb(id, ctx);
  if (kb instanceof Response) return kb;

  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id, filename")
    .eq("id", docId)
    .eq("kb_id", id)
    .maybeSingle();
  if (error) {
    console.error("[kb document reindex] query failed", error);
    return apiError("加载文档失败，请重试", "INTERNAL_ERROR");
  }
  if (!doc) return apiError("文档不存在", "NOT_FOUND");

  const { data: flipped, error: flipErr } = await db
    .from("kb_documents")
    .update({ status: "pending", error_msg: "", updated_at: new Date().toISOString() })
    .eq("id", docId)
    .in("status", ["done", "failed"])
    .select("id");
  if (flipErr) {
    console.error("[kb document reindex] status update failed", flipErr);
    return apiError("重建排队失败，请重试", "INTERNAL_ERROR");
  }
  if (!flipped || flipped.length === 0) {
    return apiError("该文档正在索引中，请等待当前索引完成后再重建", "CONFLICT");
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code ?? null,
    action: "update",
    resourceType: "knowledge_base",
    resourceId: id,
    detail: { document_id: docId, filename: doc.filename, reindex: true },
  });

  after(async () => {
    try {
      await ingestDocument(docId);
    } catch (e) {
      console.error("[kb documents reindex after] ingest failed", docId, e);
    }
  });

  const { data: pendingDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", docId)
    .maybeSingle();
  return NextResponse.json({ document: pendingDoc });
}
