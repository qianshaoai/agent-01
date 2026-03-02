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

    // 上传到 Supabase Storage
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
    const path = `${user.tenantCode}/${Date.now()}-${file.name}`;

    const { data: uploadData, error: uploadError } = await db.storage
      .from(bucket)
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[upload] storage error:", uploadError);
      return NextResponse.json({ error: "文件上传失败" }, { status: 500 });
    }

    // 提取文本
    let extractedText = "";
    if (fileType === "txt" || fileType === "csv") {
      extractedText = buffer.toString("utf-8").slice(0, 50000);
    } else if (fileType === "pdf") {
      // MVP: 暂用占位提示，生产环境可接入 pdf-parse
      extractedText = `[PDF 文件: ${file.name}，文本提取需服务端 pdf-parse 支持]`;
    } else if (fileType === "docx" || fileType === "doc") {
      extractedText = `[Word 文件: ${file.name}，文本提取需服务端 mammoth 支持]`;
    } else if (fileType === "xlsx") {
      extractedText = `[Excel 文件: ${file.name}，文本提取需服务端 xlsx 支持]`;
    } else {
      extractedText = `[图片: ${file.name}，可由多模态模型直接处理]`;
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
