import { dbError, apiError } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "category", "update", { row: { id } });
    if (accessErr) return accessErr;
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return apiError("未提供文件", "VALIDATION_ERROR");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "svg", "webp"];
  if (!allowed.includes(ext)) {
    return apiError("只支持 PNG / SVG / JPG / WEBP 格式", "VALIDATION_ERROR");
  }

  const path = `category-icons/cat-${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return apiError("文件上传失败", "INTERNAL_ERROR");

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error } = await db.from("categories").update({ icon_url: publicUrl }).eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "update",
    resourceType: "category",
    resourceId: id,
    resourceName: "图标",
  });
  return NextResponse.json({ url: publicUrl });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const accessErr = await requireAccess(ctx.actor, "category", "update", { row: { id } });
    if (accessErr) return accessErr;
  }

  const { error } = await db.from("categories").update({ icon_url: null }).eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "delete",
    resourceType: "category",
    resourceId: id,
    resourceName: "图标",
  });
  return NextResponse.json({ ok: true });
}
