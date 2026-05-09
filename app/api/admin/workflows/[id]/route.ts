import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 5.9up · 与 POST 路由对齐：校验 org_admin 提交的 permissions 都在本组织范围内
async function validateOrgAdminPermissions(
  tenantCode: string,
  permissions: Array<{ scope_type: string; scope_id: string | null }>
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return { ok: false, reason: "至少选择一个可见范围" };
  }
  const [{ data: depts }, { data: teams }] = await Promise.all([
    db.from("departments").select("id").eq("tenant_code", tenantCode),
    db.from("teams").select("id").eq("tenant_code", tenantCode),
  ]);
  const deptIds = new Set((depts ?? []).map((d: { id: string }) => d.id));
  const teamIds = new Set((teams ?? []).map((t: { id: string }) => t.id));
  for (const p of permissions) {
    if (p.scope_type === "org") {
      if (p.scope_id !== tenantCode) return { ok: false, reason: "组织管理员只能选本组织" };
    } else if (p.scope_type === "dept") {
      if (!p.scope_id || !deptIds.has(p.scope_id)) return { ok: false, reason: "所选部门不属于本组织" };
    } else if (p.scope_type === "team") {
      if (!p.scope_id || !teamIds.has(p.scope_id)) return { ok: false, reason: "所选小组不属于本组织" };
    } else {
      return { ok: false, reason: `不支持的 scope_type=${p.scope_type}` };
    }
  }
  return { ok: true };
}

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
  // 5.9up · org_admin 也可改 visible_to，但只能在 org_only / custom 之间（不能放出本组织）
  if (body.visibleTo !== undefined) {
    if (admin.role === "org_admin") {
      if (body.visibleTo !== "org_only" && body.visibleTo !== "custom") {
        return apiError("组织管理员只能在本组织范围内设置可见权限", "FORBIDDEN");
      }
    }
    updates.visible_to = body.visibleTo;
  }

  if (Object.keys(updates).length > 0) {
    const { data: wfRow } = await db.from("workflows").select("name").eq("id", id).single();
    const { error } = await db
      .from("workflows")
      .update(updates)
      .eq("id", id);
    if (error) return dbError(error);
    const action = updates.enabled === true ? "enable" : updates.enabled === false ? "disable" : "update";
    await writeAuditLog({
      adminId: admin.adminId,
      adminUsername: admin.username,
      adminRole: admin.role ?? "super_admin",
      action,
      resourceType: "workflow",
      resourceId: id,
      resourceName: wfRow?.name,
    });
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
  // 5.9up · org_admin 现在也可以改 permissions，但要校验都在本组织范围内
  if (body.permissions !== undefined) {
    let perms: Array<{ scope_type: string; scope_id: string | null }> =
      Array.isArray(body.permissions) ? body.permissions : [];

    if (admin.role === "org_admin" && admin.tenantCode) {
      // 5.9up：org_admin 选"全员可见"时前端传空数组 + visibleTo='org_only'，
      // 后端在此自动补一条 scope=org，与 POST 路径行为一致
      if (perms.length === 0 && (body.visibleTo === "org_only" || updates.visible_to === "org_only")) {
        perms = [{ scope_type: "org", scope_id: admin.tenantCode }];
      } else {
        const result = await validateOrgAdminPermissions(admin.tenantCode, perms);
        if (!result.ok) return apiError(result.reason, "FORBIDDEN");
      }
    }

    await db
      .from("resource_permissions")
      .delete()
      .eq("resource_type", "workflow")
      .eq("resource_id", id);

    if (perms.length > 0) {
      await db.from("resource_permissions").insert(
        perms.map((p) => ({
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

  const { data: deleted, error } = await db.from("workflows").delete().eq("id", id).select("id, name");
  if (error) return dbError(error);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role ?? "super_admin",
    action: "delete",
    resourceType: "workflow",
    resourceId: id,
    resourceName: (deleted?.[0] as { name?: string })?.name,
  });

  return NextResponse.json({ ok: true });
}
