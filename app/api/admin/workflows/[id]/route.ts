import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.visibleTo !== undefined) updates.visible_to = body.visibleTo;

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from("workflows")
      .update(updates)
      .eq("id", id);
    if (error) return dbError(error);
  }

  // 更新分类关联（全量替换）
  if (Array.isArray(body.categoryIds)) {
    await db.from("workflow_categories").delete().eq("workflow_id", id);
    if (body.categoryIds.length > 0) {
      await db.from("workflow_categories").insert(
        body.categoryIds.map((cid: string) => ({ workflow_id: id, category_id: cid }))
      );
    }
  }

  // 更新可见权限规则（全量替换）
  // 只要前端传了 permissions 字段（即使是空数组），就视为要覆盖旧规则
  if (body.permissions !== undefined) {
    await db
      .from("resource_permissions")
      .delete()
      .eq("resource_type", "workflow")
      .eq("resource_id", id);

    const perms = Array.isArray(body.permissions) ? body.permissions : [];
    if (perms.length > 0) {
      await db.from("resource_permissions").insert(
        perms.map((p: { scope_type: string; scope_id: string | null }) => ({
          resource_type: "workflow",
          resource_id: id,
          scope_type: p.scope_type,
          scope_id: p.scope_id,
        }))
      );
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  // 级联清理：该工作流相关的所有权限规则
  await db
    .from("resource_permissions")
    .delete()
    .eq("resource_type", "workflow")
    .eq("resource_id", id);

  const { error } = await db.from("workflows").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
