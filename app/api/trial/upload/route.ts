import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { getTrialAgentRaw } from "@/lib/trial-agents";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;        // 10MB
const MAX_FILE_BYTES = 20 * 1024 * 1024;         // 20MB

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const DOC_EXTS = new Set(["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md"]);

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
 *   - agent_id: string  （决定使用哪个智能体的 API Token 上传到 Coze）
 *   - file: File
 *
 * 返回 { file_id, file_name, bytes, kind }
 */
export async function POST(req: NextRequest) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

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
      { error: "不支持的文件类型，仅支持图片（jpg/png/gif/webp/bmp）和文档（pdf/docx/xlsx/csv/txt/md）" },
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

  // 转发到 Coze
  const cozeForm = new FormData();
  cozeForm.append("file", file, fileName);

  let res: Response;
  try {
    res = await fetch("https://api.coze.cn/v1/files/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${agent.apiToken}` },
      body: cozeForm,
    });
  } catch {
    return NextResponse.json(
      { error: "上传到 Coze 失败", code: "UPSTREAM_ERROR" },
      { status: 502 }
    );
  }

  const json = await res.json().catch(() => null);
  if (!json || json.code !== 0 || !json.data?.id) {
    return NextResponse.json(
      { error: json?.msg ?? "Coze 拒绝上传", code: "UPSTREAM_ERROR" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    file_id: json.data.id,
    file_name: json.data.file_name ?? fileName,
    bytes: json.data.bytes ?? file.size,
    kind,
  });
}
