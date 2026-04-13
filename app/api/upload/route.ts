import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

// 支持的文件类型
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
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
    case "xlsx": return hex.startsWith("504B0304") || hex.startsWith("504B0506") || hex.startsWith("504B0708"); // ZIP (OOXML 是 zip 包)
    case "doc":  return hex.startsWith("D0CF11E0A1B11AE1"); // OLE2 Compound
    case "txt":
    case "csv":  return true; // 纯文本没固定头，跳过
    default:     return false;
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const conversationId = formData.get("conversationId") as string | null;

  if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "文件不能超过 20MB" }, { status: 400 });
  }

  const fileType = ALLOWED_TYPES[file.type];
  if (!fileType) {
    return NextResponse.json(
      { error: "不支持的文件格式，请上传 PDF/Word/TXT/Excel/图片" },
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
    if (fileType === "txt" || fileType === "csv") {
      extractedText = buffer.toString("utf-8").slice(0, 50000);
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
    } else {
      // 图片：返回公开 URL 供多模态模型处理
      const { data: imgUrl } = db.storage.from(bucket).getPublicUrl(uploadData.path);
      extractedText = `[图片: ${file.name}，URL: ${imgUrl.publicUrl}]`;
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

    return NextResponse.json({
      ok: true,
      filename: file.name,
      fileType,
      url: publicUrl.publicUrl,
      extractedText,
    });
  } catch (e) {
    console.error("[upload]", e);
    return NextResponse.json({ error: "文件处理失败" }, { status: 500 });
  }
}
