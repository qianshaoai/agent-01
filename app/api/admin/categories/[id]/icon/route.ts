import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// 上传/替换智能体分类图标
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "未提供文件" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "svg", "webp"];
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: "只支持 PNG / SVG / JPG / WEBP 格式" }, { status: 400 });
  }

  const path = `category-icons/cat-${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error } = await db.from("categories").update({ icon_url: publicUrl }).eq("id", id);
  if (error) return dbError(error);

  return NextResponse.json({ url: publicUrl });
}

// 删除分类图标
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role === "org_admin") {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await db.from("categories").update({ icon_url: null }).eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
