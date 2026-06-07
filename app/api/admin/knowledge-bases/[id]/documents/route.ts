import { apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import type { AdminPayload } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET, KB_STORAGE_PREFIX } from "@/lib/kb/ingest";
import { requireAdminActor } from "@/lib/session";
import {
  canReadRow,
  canWriteRow,
  requireWriteAccess,
  validateTenantCode,
} from "@/lib/scoped-access";
import { NextRequest, NextResponse, after } from "next/server";

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

const SUPPORTED_EXT = ["pdf", "docx", "doc", "txt", "md", "csv", "xlsx", "xls", "pptx"];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, total_chunks, char_count, error_msg, created_at";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;

  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb documents list] parent kb query failed", kbErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  if (!ctx.isCustomAdmin && !canReadRow(ctx.access as AdminPayload, kb)) {
    return apiError("知识库不存在", "NOT_FOUND");
  }
  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "knowledge_base", "read", { row: kb });
    if (accessErr) return accessErr;
  }

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
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (!ctx.isCustomAdmin) {
    const gate = requireWriteAccess(ctx.access as AdminPayload, [...KB_WRITE_ROLES]);
    if (gate) return gate;
  }

  const { id: kbId } = await params;

  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", kbId)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb documents upload] parent kb query failed", kbErr);
    return apiError("加载知识库失败，请重试", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  if (!ctx.isCustomAdmin && !canWriteRow(ctx.access as AdminPayload, kb)) {
    return apiError("知识库不存在", "NOT_FOUND");
  }
  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "knowledge_base", "update", { row: kb });
    if (accessErr) return accessErr;
  }

  if ((ctx.role === "org_admin" || ctx.isCustomAdmin) && ctx.tenantCode) {
    const ok = await validateTenantCode(ctx.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }

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
    console.error("[kb documents upload] storage upload failed", upErr);
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
      created_by: ctx.adminId,
    })
    .select("id")
    .single();
  if (insErr || !doc) {
    console.error("[kb documents upload] insert failed", insErr);
    await db.storage.from(KB_STORAGE_BUCKET).remove([storagePath]);
    return apiError("文档入库失败，请重试", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code ?? null,
    action: "create",
    resourceType: "knowledge_base",
    resourceId: kbId,
    detail: { document_id: doc.id, filename, file_type: ext },
  });

  after(async () => {
    try {
      await ingestDocument(doc.id);
    } catch (e) {
      console.error("[kb documents upload after] ingest failed", doc.id, e);
    }
  });

  const { data: pendingDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", doc.id)
    .maybeSingle();

  return NextResponse.json({ document: pendingDoc });
}
