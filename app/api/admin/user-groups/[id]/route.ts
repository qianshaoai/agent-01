import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const { name, description } = await req.json();
  if (!name?.trim()) return apiError("分组名称不能为空", "VALIDATION_ERROR");

  const { data, error } = await db
    .from("user_groups")
    .update({ name: name.trim(), description: description?.trim() ?? "" })
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: "update", resourceType: "user_group", resourceId: id, resourceName: data.name,
  });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 检查是否被权限配置引用
  const { count } = await db
    .from("resource_permissions")
    .select("*", { count: "exact", head: true })
    .eq("scope_type", "group")
    .eq("scope_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `该分组还被 ${count} 条权限配置引用，请先移除相关权限后再删除` },
      { status: 409 }
    );
  }

  const { data: grp } = await db.from("user_groups").select("name").eq("id", id).maybeSingle();
  const { error } = await db.from("user_groups").delete().eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: "delete", resourceType: "user_group", resourceId: id, resourceName: grp?.name,
  });
  return NextResponse.json({ ok: true });
}
