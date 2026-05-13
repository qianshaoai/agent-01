import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.13up · 登录页展示图上传（POST）+ 清除（DELETE）
// 仅 super_admin 可改；模板抄 contact-qr route，加 5MB 文件大小硬限。
// 白名单不含 SVG / GIF —— 展示图是摄影/插画语义，不需要矢量也不要动图。

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("无权修改登录页展示图", "FORBIDDEN");
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return apiError("未提供文件", "VALIDATION_ERROR");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "webp"];
  if (!allowed.includes(ext)) {
    return apiError("只支持 PNG / JPG / WEBP 格式", "VALIDATION_ERROR");
  }

  if (file.size > MAX_SIZE) {
    return apiError(
      `图片不能超过 5MB，当前 ${(file.size / 1024 / 1024).toFixed(1)}MB`,
      "VALIDATION_ERROR"
    );
  }

  const filePath = `logos/login-showcase.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await db.storage
    .from("uploads")
    .upload(filePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[login-showcase upload]", uploadError);
    return apiError("文件上传失败", "INTERNAL_ERROR");
  }

  const { data: urlData } = db.storage.from("uploads").getPublicUrl(filePath);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

  await db.from("system_settings").upsert(
    { key: "login_showcase_url", value: publicUrl, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "settings", resourceName: "登录页展示图",
  });
  return NextResponse.json({ url: publicUrl });
}

export async function DELETE() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("无权删除登录页展示图", "FORBIDDEN");
  }

  // 清空 settings 值即可回退到默认纯色，Storage 里的文件不动（保留少占用 IO）
  await db.from("system_settings").upsert(
    { key: "login_showcase_url", value: "", updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "delete", resourceType: "settings", resourceName: "登录页展示图",
  });
  return NextResponse.json({ ok: true });
}
