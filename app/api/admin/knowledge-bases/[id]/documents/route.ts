import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { ingestDocument, KB_STORAGE_BUCKET, KB_STORAGE_PREFIX } from "@/lib/kb/ingest";
import { writeAuditLog } from "@/lib/audit";
import {
  canReadRow,
  canWriteRow,
  requireWriteAccess,
  validateTenantCode,
} from "@/lib/scoped-access";

// 5.19up 知识库方案 A · PR-A3 · 知识库文档 列表 + 上传
// 5.30up · B 半 RBAC 改造（R2 通过）：
//   - GET：父 KB load → canReadRow（404 屏蔽）
//   - POST：requireWriteAccess + canWriteRow（404 屏蔽）+ 审计

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

const SUPPORTED_EXT = ["pdf", "docx", "doc", "txt", "md", "csv", "xlsx", "xls", "pptx"];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

const DOC_FIELDS =
  "id, kb_id, filename, file_type, status, chunk_count, total_chunks, char_count, error_msg, created_at";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 5.30up · 父 KB load → canReadRow → 404 屏蔽
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb documents list] 父 KB 查询失败", kbErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");
  if (!canReadRow(admin, kb)) return apiError("知识库不存在", "NOT_FOUND");

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

  // 5.30up · R2 §1 双闸门
  const gate = requireWriteAccess(admin, [...KB_WRITE_ROLES]);
  if (gate) return gate;

  const { id: kbId } = await params;

  // 5.30up · 父 KB load → canWriteRow → 404 屏蔽（防 org_admin 把文档塞到别 org 的 KB）
  const { data: kb, error: kbErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", kbId)
    .maybeSingle();
  if (kbErr) {
    console.error("[kb documents upload] 父 KB 查询失败", kbErr);
    return apiError("加载知识库失败，请重试", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");
  if (!canWriteRow(admin, kb)) return apiError("知识库不存在", "NOT_FOUND");

  // 5.30up · org_admin 额外校验 admin.tenantCode 在 tenants 存在
  if (admin.role === "org_admin" && admin.tenantCode) {
    const ok = await validateTenantCode(admin.tenantCode);
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

  // 5.30up · R2 §5 · 文档上传审计：资源记父 KB（含 tenant_code），detail 带 document_id + filename
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode: kb.tenant_code,
    action: "create",
    resourceType: "knowledge_base",
    resourceId: kbId,
    detail: { document_id: doc.id, filename, file_type: ext },
  });

  // 5.28up · A · ingest 转后台异步：next/server `after()` 在响应发出后继续在
  //   同进程里跑（Next 15+ 稳定 API）。upload POST 立刻返回 pending 状态，
  //   前端轮询文档列表看 status 从 pending → indexing → done/failed。
  //   旧 D6 同步语义：D6（同步摄取）在大文档上必超时；这条注释保留作为历史索引。
  after(async () => {
    try {
      await ingestDocument(doc.id);
    } catch (e) {
      // ingestDocument 内部已经 try/catch 落到 status=failed；这里再兜一层防 after 上下文吞错
      console.error("[kb documents upload · after()] ingest 异常", doc.id, e);
    }
  });

  // 返回此刻 DB 里的 pending 行；前端据 status 轮询直到 done/failed
  const { data: pendingDoc } = await db
    .from("kb_documents")
    .select(DOC_FIELDS)
    .eq("id", doc.id)
    .maybeSingle();

  return NextResponse.json({ document: pendingDoc });
}
