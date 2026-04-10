import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "未提供文件" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "webp", "gif"];
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: "只支持 PNG / JPG / WEBP 格式" }, { status: 400 });
  }

  const filePath = `logos/contact-qr.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(filePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[contact-qr upload]", uploadError);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
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
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  await db.from("system_settings").upsert(
    { key: "contact_qr_url", value: "", updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true });
}
