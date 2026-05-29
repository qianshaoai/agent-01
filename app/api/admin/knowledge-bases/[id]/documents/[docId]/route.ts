import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET } from "@/lib/kb/ingest";
import { writeAuditLog } from "@/lib/audit";
import {
  canWriteRow,
  requireWriteAccess,
  validateTenantCode,
} from "@/lib/scoped-access";

// 5.19up 知识库方案 A · PR-A3 · 知识库文档 删除 / 重建索引
// 5.30up · B 半 RBAC 改造（R2 通过）：
//   - DELETE / POST(reindex)：requireWriteAccess + 父 KB load → canWriteRow（404 屏蔽）+ 审计

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, total_chunks, char_count, error_msg, created_at";

/** DELETE：删除文档（kb_chunks 由 FK 级联删除）+ 清存储文件 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 5.30up · R2 §1 双闸门
  const gate = requireWriteAccess(admin, [...KB_WRITE_ROLES]);
  if (gate) return gate;

  // 小B finding 3：必须校验 docId 属于 URL 里的 kbId，否则错误 URL 可操作别库的文档
  const { id, docId } = await params;

  // 5.30up · 父 KB load → canWriteRow → 404 屏蔽（防 org_admin 删别 org KB 的文档）
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb document delete] 父 KB 查询失败", kbErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");
  if (!canWriteRow(admin, kb)) return apiError("知识库不存在", "NOT_FOUND");

  if (admin.role === "org_admin" && admin.tenantCode) {
    const ok = await validateTenantCode(admin.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }

  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id, filename, storage_path")
    .eq("id", docId)
    .eq("kb_id", id)
    .maybeSingle();
  if (error) {
    console.error("[kb document delete] 查询失败", error);
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
    if (rmErr) console.error("[kb document delete] 清存储文件失败（不阻断）", rmErr);
  }

  // 5.30up · R2 §5 · 文档删除审计：资源仍记父 KB（KB 还在，无需缓存 tenant_code）
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code,
    action: "delete",
    resourceType: "knowledge_base",
    resourceId: id,
    detail: { document_id: docId, filename: doc.filename },
  });

  return NextResponse.json({ ok: true });
}

/** POST：重建索引 —— 重新摄取该文档（ingestDocument 会先清旧切片，可重复执行） */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 5.30up · R2 §1 双闸门
  const gate = requireWriteAccess(admin, [...KB_WRITE_ROLES]);
  if (gate) return gate;

  // 小B finding 3：校验 docId 属于 URL 里的 kbId
  const { id, docId } = await params;

  // 5.30up · 父 KB load → canWriteRow → 404 屏蔽
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb document reindex] 父 KB 查询失败", kbErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");
  if (!canWriteRow(admin, kb)) return apiError("知识库不存在", "NOT_FOUND");

  if (admin.role === "org_admin" && admin.tenantCode) {
    const ok = await validateTenantCode(admin.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }

  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id, filename")
    .eq("id", docId)
    .eq("kb_id", id)
    .maybeSingle();
  if (error) {
    console.error("[kb document reindex] 查询失败", error);
    return apiError("加载文档失败，请重试", "INTERNAL_ERROR");
  }
  if (!doc) return apiError("文档不存在", "NOT_FOUND");

  // 5.28up · A · 重建索引走 after() 异步。
  // Fix 3 · 服务端并发保护：原子 UPDATE 只允许从终态 (done/failed) 翻到 pending。
  //   多 tab / 手工 curl 并发请求时，第一条 UPDATE 成功（终态→pending），
  //   后续 UPDATE 因 status 不在终态集而 0 行影响 → 拒绝（不重复排 ingest），
  //   避免 ingestDocument 并发跑同一文档清旧 chunks + 互相冲掉的竞态。
  //   .in('status', [...]) + .select() 返回受影响行；空数组 = 当前 pending/indexing 中。
  const { data: flipped, error: flipErr } = await db
    .from("kb_documents")
    .update({ status: "pending", error_msg: "", updated_at: new Date().toISOString() })
    .eq("id", docId)
    .in("status", ["done", "failed"])
    .select("id");
  if (flipErr) {
    console.error("[kb document reindex] 状态翻转失败", flipErr);
    return apiError("重建排队失败，请重试", "INTERNAL_ERROR");
  }
  if (!flipped || flipped.length === 0) {
    // 5.28up · 小B 复审 Fix 4 · 状态冲突应为 409 不是 400；CONFLICT 已映到 409
    return apiError("该文档正在索引中，请等待当前索引完成后再重建", "CONFLICT");
  }

  // 5.30up · R2 §5 · 重建索引审计：action=update，detail 标记 reindex=true
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code,
    action: "update",
    resourceType: "knowledge_base",
    resourceId: id,
    detail: { document_id: docId, filename: doc.filename, reindex: true },
  });

  after(async () => {
    try {
      await ingestDocument(docId);
    } catch (e) {
      console.error("[kb documents reindex · after()] ingest 异常", docId, e);
    }
  });

  const { data: pendingDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", docId)
    .maybeSingle();
  return NextResponse.json({ document: pendingDoc });
}
