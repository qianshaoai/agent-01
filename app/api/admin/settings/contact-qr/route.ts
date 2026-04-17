import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return apiError("未提供文件", "VALIDATION_ERROR");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "webp", "gif"];
  if (!allowed.includes(ext)) {
    return apiError("只支持 PNG / JPG / WEBP 格式", "VALIDATION_ERROR");
  }

  const filePath = `logos/contact-qr.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(filePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[contact-qr upload]", uploadError);
    return apiError("文件上传失败", "INTERNAL_ERROR");
  }

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(filePath);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  await db.from("system_settings").upsert(
    { key: "contact_qr_url", value: publicUrl, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  return NextResponse.json({ url: publicUrl });
}

export async function DELETE() {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  await db.from("system_settings").upsert(
    { key: "contact_qr_url", value: "", updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true });
}
