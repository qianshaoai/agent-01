import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "未提供文件" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "svg", "webp", "gif"];
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: "只支持 PNG / SVG / JPG / WEBP 格式" }, { status: 400 });
  }

  // 固定路径，上传时自动覆盖旧 Logo
  const path = `logos/site-logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(path);
  // 附加时间戳避免浏览器缓存旧图
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  // 同步更新 system_settings
  await db.from("system_settings").upsert(
    { key: "logo_url", value: publicUrl, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  return NextResponse.json({ url: publicUrl });
}
