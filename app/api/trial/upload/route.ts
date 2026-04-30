import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;        // 10MB
const MAX_FILE_BYTES = 20 * 1024 * 1024;         // 20MB

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const DOC_EXTS = new Set(["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "pptx"]);

type Kind = "image" | "file";

function detectKind(filename: string, mimeType: string): Kind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext) || mimeType.startsWith("image/")) return "image";
  if (DOC_EXTS.has(ext)) return "file";
  return null;
}

/**
 * POST /api/trial/upload
 * multipart/form-data:
 *   - agent_id: string  （决定上传到 Coze 还是仅 Supabase）
 *   - file: File
 *
 * 4.30up 通用化：
 *   - 所有附件都先上传到 Supabase Storage 拿公开 URL（任何平台 adapter 都能用）
 *   - 如果 platform === "coze"，再额外上传到 Coze 拿 file_id（保留 Coze 原生文件能力）
 *
 * 返回 { file_name, bytes, kind, url, cozeFileId? }
 */
export async function POST(req: NextRequest) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  const userId = payload!.type === "user" ? payload!.userId : "";
  if (!userId) return NextResponse.json({ error: "无效会话" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "上传请求格式错误" }, { status: 400 });
  }

  const agentId = (form.get("agent_id") as string) ?? "";
  const file = form.get("file");

  if (!agentId || !(file instanceof Blob)) {
    return NextResponse.json({ error: "agent_id 和 file 必填" }, { status: 400 });
  }

  const agent = getTrialAgentRaw(agentId);
  if (!agent) {
    return NextResponse.json({ error: `trial agent not found: ${agentId}` }, { status: 404 });
  }
  if (!agent.botId || !agent.apiToken) {
    return NextResponse.json(
      { error: "trial agent 配置缺失", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }

  const fileName = (file as File).name ?? "upload";
  const mimeType = file.type ?? "";
  const kind = detectKind(fileName, mimeType);
  if (!kind) {
    return NextResponse.json(
      { error: "不支持的文件类型，仅支持图片（jpg/png/gif/webp/bmp）和文档（pdf/docx/xlsx/pptx/csv/txt/md）" },
      { status: 400 }
    );
  }

  const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
  if (file.size > limit) {
    return NextResponse.json(
      { error: `文件过大，${kind === "image" ? "图片" : "文档"}单个不超过 ${limit / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  // ── 1. 必做：上传到 Supabase Storage 拿公开 URL ─────────────────────
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `trial/${userId}/${Date.now()}-${safeName}`;

  let buffer: Buffer;
  try {
    const ab = await file.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: "读取文件失败" }, { status: 400 });
  }

  const { error: storageErr } = await db.storage
    .from(bucket)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (storageErr) {
    console.error("[trial_upload] supabase storage error:", storageErr);
    return NextResponse.json(
      { error: "文件上传失败，请重试", code: "STORAGE_ERROR" },
      { status: 500 }
    );
  }
  const { data: pub } = db.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  // ── 2. 可选：Coze 平台 + （图片 或 nativeDocuments=true 的文档）才上传到 Coze ─
  // 文档但 nativeDocuments=false 时跳过：portal 会在 chat 里文本提取后塞正文，
  //   没必要花一次 Coze 上传
  const needCozeUpload =
    agent.platform === "coze" &&
    (kind === "image" || agent.capabilities.nativeDocuments);

  let cozeFileId: string | undefined;
  if (needCozeUpload) {
    const cozeForm = new FormData();
    cozeForm.append("file", file, fileName);
    try {
      const res = await fetch("https://api.coze.cn/v1/files/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${agent.apiToken}` },
        body: cozeForm,
      });
      const json = await res.json().catch(() => null);
      if (json && json.code === 0 && json.data?.id) {
        cozeFileId = json.data.id;
      } else {
        // Coze 上传失败不阻断 — 退化到只用 Supabase URL（image 仍能 file_url 走，
        // file 类型 Coze 看不懂会降级文本提示）
        console.warn("[trial_upload] coze upload failed, fallback to URL:", json?.msg);
      }
    } catch (e) {
      console.warn("[trial_upload] coze upload exception, fallback to URL:", e);
    }
  }

  return NextResponse.json({
    file_name: fileName,
    bytes: file.size,
    kind,
    url: publicUrl,
    ...(cozeFileId ? { cozeFileId } : {}),
  });
}
