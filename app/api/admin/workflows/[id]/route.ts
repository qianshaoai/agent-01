import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// 5.7up · 工具：org_admin 改 / 删工作流前，校验该工作流是否归属本组织
// 归属判定：resource_permissions 里有 scope=本组织/本组织部门/本组织小组
async function ensureOrgAdminCanTouch(
  admin: { role: string; tenantCode?: string | null },
  workflowId: string
): Promise<Response | null> {
  if (admin.role !== "org_admin") return null;
  if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
  const tenantCode = admin.tenantCode;

  const [{ data: depts }, { data: teams }] = await Promise.all([
    db.from("departments").select("id").eq("tenant_code", tenantCode),
    db.from("teams").select("id").eq("tenant_code", tenantCode),
  ]);
  const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id);

  const orFilters: string[] = [`and(scope_type.eq.org,scope_id.eq.${tenantCode})`];
  if (deptIds.length > 0) orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
  if (teamIds.length > 0) orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);

  const { data: hits } = await db
    .from("resource_permissions")
    .select("resource_id")
    .eq("resource_type", "workflow")
    .eq("resource_id", workflowId)
    .or(orFilters.join(","))
    .limit(1);

  if (!hits || hits.length === 0) {
    return apiError("无权操作该工作流", "FORBIDDEN");
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const guard = await ensureOrgAdminCanTouch(admin, id);
  if (guard) return guard;

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  // 5.7up · org_admin 不可改 visible_to（保持创建时的 'org_only'）
  if (body.visibleTo !== undefined && admin.role !== "org_admin") {
    updates.visible_to = body.visibleTo;
  }

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
  // 5.7up · org_admin 不可重写 permissions（保持本组织绑定）
  if (body.permissions !== undefined && admin.role !== "org_admin") {
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
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const guard = await ensureOrgAdminCanTouch(admin, id);
  if (guard) return guard;

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
