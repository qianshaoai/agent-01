import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessPayload, requireAdminActor } from "@/lib/session";
import { isCustomAdminPayload, type AdminPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";
import {
  buildPermissionActor,
  hasPermission,
  PermissionActor,
  ResourceScope,
} from "@/lib/permission-actor";
import { PermissionKey } from "@/lib/permission-keys";
// 6.4up v2 Phase D · D-3 · workflow builtin 路径 enforce（env "workflow" 启用时生效；空时 no-op）
//   custom_admin 分支完全不走 requireAccess（R0.1 F3 双通道隔离）。
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";

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

// 5.11up · 工具：上下级权限校验。读取该 workflow 的 created_by_role，对照当前 admin 等级
// 历史 NULL 数据在 migration_v31 已回填为 system_admin
async function ensureAdminHierarchyAllows(
  admin: { role: string },
  workflowId: string
): Promise<Response | null> {
  const { data: wf } = await db
    .from("workflows")
    .select("created_by_role")
    .eq("id", workflowId)
    .single();
  if (!wf) return apiError("工作流不存在", "NOT_FOUND");
  const creatorRole = (wf.created_by_role ?? null) as AdminRole | null;
  const actorRole = (admin.role ?? "super_admin") as AdminRole;
  if (!canActOnRole(actorRole, creatorRole)) {
    return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
  }
  return null;
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

// 6.4up · 取目标 workflow 的全部 scope（resource_permissions 行），custom admin update 校验用
async function getWorkflowScopes(workflowId: string): Promise<ResourceScope[]> {
  const { data } = await db
    .from("resource_permissions")
    .select("scope_type, scope_id")
    .eq("resource_type", "workflow")
    .eq("resource_id", workflowId);
  type Row = { scope_type: string; scope_id: string | null };
  return (data ?? []).map((r) => ({
    scope_type: (r as Row).scope_type as ResourceScope["scope_type"],
    scope_id: (r as Row).scope_id,
  }));
}

/** custom admin 持有的最高级 update key */
function pickUpdateKey(actor: PermissionActor): PermissionKey | null {
  const order: PermissionKey[] = [
    "workflow.update.all",
    "workflow.update.org",
    "workflow.update.dept",
    "workflow.update.team",
  ];
  for (const k of order) if (actor.permissions.has(k)) return k;
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 6.4up · 双通道认证
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  if (!isCustomAdminPayload(access) && access.firstLogin === true) {
    return apiError("首次登录需先修改初始密码", "FORBIDDEN");
  }
  const { id } = await params;

  // ── 6.4up · custom admin PATCH ──
  if (isCustomAdminPayload(access)) {
    const actor = await buildPermissionActor(access);
    const updateKey = pickUpdateKey(actor);
    if (!updateKey) return apiError("无修改工作流权限", "FORBIDDEN");

    const { data: wfRow } = await db
      .from("workflows")
      .select("id, name")
      .eq("id", id)
      .maybeSingle();
    if (!wfRow) return apiError("工作流不存在", "NOT_FOUND");

    const targetScopes = await getWorkflowScopes(id);
    if (targetScopes.length === 0) {
      // 没有任何 scope 行 → 无法判定归属，custom admin 拒绝（方案 R1.2 P0-5：禁止用 visible_to 字面值兜底）
      return apiError("工作流无 scope 归属，custom admin 无法修改", "FORBIDDEN");
    }
    const allowed = await hasPermission(actor, updateKey, targetScopes);
    if (!allowed) return apiError("目标工作流超出权限范围", "FORBIDDEN");

    const body = await req.json();
    // R1.2 · 验收 15：禁止改 enabled；同时禁止改 visible_to / permissions（避免越权扩散可见性）
    if (body.enabled !== undefined) {
      return apiError("custom 角色不能启停工作流", "FORBIDDEN");
    }
    if (body.visibleTo !== undefined || body.permissions !== undefined) {
      return apiError("custom 角色不能调整可见范围", "FORBIDDEN");
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.category !== undefined) updates.category = body.category;
    if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;

    if (Object.keys(updates).length > 0) {
      const { error } = await db.from("workflows").update(updates).eq("id", id);
      if (error) return dbError(error);
    }
    // 分类关联
    if (Array.isArray(body.categoryIds)) {
      await db.from("workflow_categories").delete().eq("workflow_id", id);
      if (body.categoryIds.length > 0) {
        await db.from("workflow_categories").insert(
          body.categoryIds.map((cid: string) => ({ workflow_id: id, category_id: cid }))
        );
      }
    }

    await writeAuditLog({
      adminId: actor.actorId,
      adminUsername: actor.username,
      adminRole: "custom_admin",
      adminTenantCode: actor.tenantCode ?? null,
      action: "update",
      resourceType: "workflow",
      resourceId: id,
      resourceName: (wfRow as { name: string }).name,
      detail: {
        permission_key: updateKey,
        scopes: targetScopes,
        updates,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // ── builtin admin PATCH（保留旧逻辑） ──
  const admin = access;
  // 5.11up · 先做上下级权限校验
  const hierarchyGuard = await ensureAdminHierarchyAllows(admin, id);
  if (hierarchyGuard) return hierarchyGuard;
  const guard = await ensureOrgAdminCanTouch(admin, id);
  if (guard) return guard;

  const body = await req.json();

  // Phase D D-3 · v2 第二闸（builtin 路径；env-gated）。custom 分支已在上方独立返回，不受影响。
  //   ensureAdminHierarchyAllows(canActOnRole) + ensureOrgAdminCanTouch 保留在前（结构性优先）。
  if (isResourceEnforced("workflow") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    if (body.enabled !== undefined) {
      const e = await requireAccess(actor, "workflow", "enable", { id });
      if (e) return e;
    }
    if (Object.keys(body).some((k) => k !== "enabled")) {
      const e = await requireAccess(actor, "workflow", "update", { id });
      if (e) return e;
    }
  }

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
      adminTenantCode: admin.tenantCode ?? null,
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
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.isCustomAdmin) {
    const e = await requireAccess(ctx.actor, "workflow", "delete", { id });
    if (e) return e;
  } else {
    const admin = ctx.access as AdminPayload;
  // 5.11up · 先做上下级权限校验
  const hierarchyGuard = await ensureAdminHierarchyAllows(admin, id);
  if (hierarchyGuard) return hierarchyGuard;
  const guard = await ensureOrgAdminCanTouch(admin, id);
  if (guard) return guard;

  // Phase D D-3 · v2 第二闸（builtin；env-gated）
    if (isResourceEnforced("workflow") && admin.role !== "super_admin") {
      const actor = await buildPermissionActor(admin);
      const e = await requireAccess(actor, "workflow", "delete", { id });
      if (e) return e;
    }
  }

  // 5.11up · DELETE 前先 snapshot 资源归属，避免删完后反查为 null 导致 org_admin 看不到这条审计
  const resourceTenantCode = await resolveResourceTenantCode("workflow", id);

  // 级联清理：该工作流相关的所有权限规则
  await db
    .from("resource_permissions")
    .delete()
    .eq("resource_type", "workflow")
    .eq("resource_id", id);

  const { data: deleted, error } = await db.from("workflows").delete().eq("id", id).select("id, name");
  if (error) return dbError(error);

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    resourceTenantCode,
    action: "delete",
    resourceType: "workflow",
    resourceId: id,
    resourceName: (deleted?.[0] as { name?: string })?.name,
  });

  return NextResponse.json({ ok: true });
}
