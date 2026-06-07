import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { isTagAdmin, type AdminRole } from "@/lib/admin-permissions";
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";

export const dynamic = "force-dynamic";

async function requireCategoryUpdate(ctx: AdminActorContext, id: string) {
  if (!ctx.isCustomAdmin && !isResourceEnforced("category") && !isTagAdmin(ctx.role as AdminRole)) {
    return apiError("无权管理标签", "FORBIDDEN");
  }
  return requireAccess(ctx.actor, "category", "update", { row: { id } });
}

// 上传/替换工作流分类图标
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const accessErr = await requireCategoryUpdate(ctx, id);
  if (accessErr) return accessErr;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return apiError("未提供文件", "VALIDATION_ERROR");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "svg", "webp"];
  if (!allowed.includes(ext)) {
    return apiError("只支持 PNG / SVG / JPG / WEBP 格式", "VALIDATION_ERROR");
  }

  const path = `wf-category-icons/wfcat-${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return apiError("文件上传失败", "INTERNAL_ERROR");

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  const { error } = await db.from("wf_categories").update({ icon_url: publicUrl }).eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode ?? null,
    action: "update", resourceType: "wf_category", resourceId: id, resourceName: "图标",
  });
  return NextResponse.json({ url: publicUrl });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const accessErr = await requireCategoryUpdate(ctx, id);
  if (accessErr) return accessErr;
  const { error } = await db.from("wf_categories").update({ icon_url: null }).eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode ?? null,
    action: "delete", resourceType: "wf_category", resourceId: id, resourceName: "图标",
  });
  return NextResponse.json({ ok: true });
}
