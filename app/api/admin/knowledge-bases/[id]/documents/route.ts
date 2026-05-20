import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET, KB_STORAGE_PREFIX } from "@/lib/kb/ingest";

// 5.19up 知识库方案 A · PR-A3 · 知识库文档 列表 + 上传
// 权限（D2）：仅 super_admin / system_admin

function denyKbAdmin(role: string): boolean {
  return role !== "super_admin" && role !== "system_admin";
}

const SUPPORTED_EXT = ["pdf", "docx", "doc", "txt", "md", "csv", "xlsx", "xls", "pptx"];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, char_count, error_msg, created_at";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权访问知识库", "FORBIDDEN");

  const { id } = await params;
  const { data, error } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("kb_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[kb documents list]", error);
    return apiError("获取文档列表失败", "INTERNAL_ERROR");
  }
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权上传文档", "FORBIDDEN");

  const { id: kbId } = await params;

  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id")
    .eq("id", kbId)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb documents upload] 知识库查询失败", kbErr);
    return apiError("加载知识库失败，请重试", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError("请求格式错误（需 multipart/form-data）", "VALIDATION_ERROR");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return apiError("请选择要上传的文件", "VALIDATION_ERROR");
  }

  const filename = file.name || "未命名文件";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_EXT.includes(ext)) {
    return apiError(`不支持的文件类型，仅支持 ${SUPPORTED_EXT.join(" / ")}`, "VALIDATION_ERROR");
  }
  if (file.size > MAX_FILE_BYTES) {
    return apiError("文件超过 20MB 上限，请拆分后上传", "VALIDATION_ERROR");
  }
  if (file.size === 0) {
    return apiError("文件为空", "VALIDATION_ERROR");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${KB_STORAGE_PREFIX}/${kbId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await db.storage
    .from(KB_STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    console.error("[kb documents upload] storage upload 失败", upErr);
    return apiError("文件上传失败，请重试", "INTERNAL_ERROR");
  }

  const { data: doc, error: insErr } = await db
    .from("kb_documents")
    .insert({
      kb_id: kbId,
      filename,
      file_type: ext,
      storage_path: storagePath,
      status: "pending",
      created_by: admin.adminId,
    })
    .select("id")
    .single();
  if (insErr || !doc) {
    console.error("[kb documents upload] 文档入库失败", insErr);
    // 回滚已上传的文件
    await db.storage.from(KB_STORAGE_BUCKET).remove([storagePath]);
    return apiError("文档入库失败，请重试", "INTERNAL_ERROR");
  }

  // D6：同步摄取（提取 → 切块 → 向量化 → 写 kb_chunks）。失败落到文档 status=failed。
  await ingestDocument(doc.id);

  const { data: finalDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", doc.id)
    .maybeSingle();

  return NextResponse.json({ document: finalDoc });
}
