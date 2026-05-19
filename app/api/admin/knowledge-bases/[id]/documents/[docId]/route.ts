import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET } from "@/lib/kb/ingest";

// 5.19up 知识库方案 A · PR-A3 · 知识库文档 删除 / 重建索引
// 权限（D2）：仅 super_admin / system_admin

function denyKbAdmin(role: string): boolean {
  return role !== "super_admin" && role !== "system_admin";
}

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, char_count, error_msg, created_at";

/** DELETE：删除文档（kb_chunks 由 FK 级联删除）+ 清存储文件 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权删除文档", "FORBIDDEN");

  const { docId } = await params;
  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id, storage_path")
    .eq("id", docId)
    .maybeSingle();
  if (error) {
    console.error("[kb document delete] 查询失败", error);
    return apiError("加载文档失败，请重试", "INTERNAL_ERROR");
  }
  if (!doc) return apiError("文档不存在", "NOT_FOUND");

  const { error: delErr } = await db.from("kb_documents").delete().eq("id", docId);
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
  return NextResponse.json({ ok: true });
}

/** POST：重建索引 —— 重新摄取该文档（ingestDocument 会先清旧切片，可重复执行） */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权重建索引", "FORBIDDEN");

  const { docId } = await params;
  const { data: doc, error } = await db
    .from("kb_documents")
    .select("id")
    .eq("id", docId)
    .maybeSingle();
  if (error) {
    console.error("[kb document reindex] 查询失败", error);
    return apiError("加载文档失败，请重试", "INTERNAL_ERROR");
  }
  if (!doc) return apiError("文档不存在", "NOT_FOUND");

  await ingestDocument(docId);

  const { data: finalDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", docId)
    .maybeSingle();
  return NextResponse.json({ document: finalDoc });
}
