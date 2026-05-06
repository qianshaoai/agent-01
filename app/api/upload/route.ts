import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { withRequestLog } from "@/lib/request-logger";

// 支持的文件类型
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// MIME 查不到时按扩展名兜底（浏览器对 .md / 部分 .txt 经常给空 MIME）
const EXT_TO_TYPE: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  xlsx: "xlsx",
  pptx: "pptx",
  txt: "txt",
  md: "md",
  csv: "csv",
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

const MAX_SIZE = 20 * 1024 * 1024; // 20MB

// 通过文件头（magic bytes）二次验证文件类型，防止伪造 Content-Type
// 注意：txt/csv/doc 没有固定文件头，只校验有固定签名的类型
function verifyMagicBytes(buffer: Buffer, declaredType: string): boolean {
  if (buffer.length < 4) return false;
  const hex = buffer.subarray(0, 12).toString("hex").toUpperCase();
  switch (declaredType) {
    case "pdf":  return hex.startsWith("25504446"); // %PDF
    case "png":  return hex.startsWith("89504E47");
    case "jpg":  return hex.startsWith("FFD8FF");
    case "webp": return hex.startsWith("52494646") && hex.slice(16, 24) === "57454250"; // RIFF....WEBP
    case "docx":
    case "xlsx":
    case "pptx": return hex.startsWith("504B0304") || hex.startsWith("504B0506") || hex.startsWith("504B0708"); // ZIP (OOXML 是 zip 包)
    case "doc":  return hex.startsWith("D0CF11E0A1B11AE1"); // OLE2 Compound
    case "txt":
    case "md":
    case "csv":  return true; // 纯文本没固定头，跳过
    default:     return false;
  }
}

export const POST = withRequestLog(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const conversationId = formData.get("conversationId") as string | null;

  if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "文件不能超过 20MB" }, { status: 400 });
  }

  // 先按 MIME 查；查不到（浏览器给空 / 非标准 MIME）按扩展名兜底
  let fileType = ALLOWED_TYPES[file.type] ?? "";
  if (!fileType) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    fileType = EXT_TO_TYPE[ext] ?? "";
  }
  if (!fileType) {
    return NextResponse.json(
      { error: "不支持的文件格式，请上传 PDF/Word/PPT/TXT/MD/Excel/图片" },
      { status: 400 }
    );
  }

  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 文件头校验，拒绝伪造 MIME 类型的文件
    if (!verifyMagicBytes(buffer, fileType)) {
      return NextResponse.json(
        { error: "文件内容与声明类型不符，拒绝上传" },
        { status: 400 }
      );
    }

    // 上传到 Supabase Storage
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
    const folder = user.tenantCode || "personal";
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${folder}/${Date.now()}-${safeName}`;

    let uploadData: { path: string } | null = null;
    let uploadError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await db.storage
        .from(bucket)
        .upload(path, buffer, { contentType: file.type, upsert: false });
      if (!result.error) {
        uploadData = result.data;
        break;
      }
      uploadError = result.error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }

    if (!uploadData) {
      console.error("[upload] storage error:", uploadError);
      return NextResponse.json({ error: "文件上传失败，请重试" }, { status: 500 });
    }

    // 提取文本
    let extractedText = "";
    if (fileType === "txt" || fileType === "csv" || fileType === "md") {
      // 编码检测：BOM → UTF-8 试解 → 回退 GBK
      let textContent: string;
      if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        // UTF-8 BOM
        textContent = buffer.subarray(3).toString("utf-8");
      } else if ((buffer[0] === 0xFF && buffer[1] === 0xFE) || (buffer[0] === 0xFE && buffer[1] === 0xFF)) {
        // UTF-16 BOM
        const encoding = buffer[0] === 0xFF ? "utf-16le" : "utf-16be";
        textContent = new TextDecoder(encoding).decode(buffer.subarray(2));
      } else {
        // 尝试 UTF-8，如果出现替换字符说明不是 UTF-8，回退 GBK
        const utf8 = buffer.toString("utf-8");
        if (utf8.includes("\uFFFD")) {
          try {
            textContent = new TextDecoder("gbk").decode(buffer);
          } catch {
            textContent = utf8;
          }
        } else {
          textContent = utf8;
        }
      }
      extractedText = textContent.slice(0, 50000);
    } else if (fileType === "pdf") {
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        extractedText = result.text.trim().slice(0, 50000);
      } catch {
        extractedText = `[PDF 文件: ${file.name}，文本提取失败，请确认文件未加密]`;
      }
    } else if (fileType === "docx") {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value.trim().slice(0, 50000);
      } catch {
        extractedText = `[Word 文件: ${file.name}，文本提取失败]`;
      }
    } else if (fileType === "doc") {
      extractedText = `[旧版 Word(.doc) 文件: ${file.name}，请另存为 .docx 格式后重新上传]`;
    } else if (fileType === "xlsx") {
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheets = workbook.SheetNames.map((name) => {
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
          return `[Sheet: ${name}]\n${csv}`;
        });
        extractedText = sheets.join("\n\n").slice(0, 50000);
      } catch {
        extractedText = `[Excel 文件: ${file.name}，文本提取失败]`;
      }
    } else if (fileType === "pptx") {
      // pptx 解析：解 zip → 取每张 slide XML 里的 <a:t> 文字
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buffer);
        const slidePaths = Object.keys(zip.files)
          .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort((a, b) => {
            const na = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
            const nb = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
            return na - nb;
          });
        const blocks: string[] = [];
        for (let i = 0; i < slidePaths.length; i++) {
          const xml = await zip.files[slidePaths[i]].async("string");
          const paragraphs = xml.split(/<a:p[\s>]/i).slice(1);
          const lines: string[] = [];
          for (const p of paragraphs) {
            const texts = [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
              m[1]
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&amp;/g, "&")
            );
            const line = texts.join("").trim();
            if (line) lines.push(line);
          }
          if (lines.length > 0) blocks.push(`## 第 ${i + 1} 页\n${lines.join("\n")}`);
        }
        extractedText = blocks.join("\n\n").slice(0, 50000);
        if (!extractedText) {
          extractedText = `[PPT 文件: ${file.name}，未提取到文字（可能仅含图片或图形元素）]`;
        }
      } catch {
        extractedText = `[PPT 文件: ${file.name}，文本提取失败]`;
      }
    } else {
      // 图片：不再把 URL 拼成文本塞进 extractedText（之前 bot 看到的是字符串，
      // 多模态模型识别不了）。改成保留空 extractedText，让前端识别 kind=image
      // 后用结构化 attachments 字段发给 chat 路由，adapter 会拼成多模态 image_url。
      extractedText = "";
    }

    // 保存到数据库（如果有 conversationId）
    if (conversationId) {
      await db.from("files").insert({
        conversation_id: conversationId,
        storage_path: uploadData.path,
        filename: file.name,
        file_type: fileType,
        extracted_text: extractedText,
      });

      await db.from("logs").insert({
        user_phone: user.phone,
        tenant_code: user.tenantCode,
        action: "upload",
        status: "success",
      });
    }

    const { data: publicUrl } = db.storage.from(bucket).getPublicUrl(uploadData.path);

    // kind: image 走多模态 attachments 链路；file 走 fileTexts 文本拼接链路
    const isImage = ["jpg", "png", "webp", "gif", "bmp"].includes(fileType);
    return NextResponse.json({
      ok: true,
      filename: file.name,
      fileType,
      kind: isImage ? "image" : "file",
      url: publicUrl.publicUrl,
      extractedText,
    });
  } catch (e) {
    console.error("[upload]", e);
    return NextResponse.json({ error: "文件处理失败" }, { status: 500 });
  }
});
