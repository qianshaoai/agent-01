import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

type WfPerm = { scope_type: string; scope_id: string | null };

// 5.9up · 校验 org_admin 提交的 permissions 是否都在本组织范围内
// 任何 dept_id / team_id 必须真实属于 admin.tenantCode；scope=org 必须等于本组织
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

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { page, pageSize, start } = parsePagination(req, 50);

  // 5.7up · org_admin 只看本组织相关工作流：
  //   visible_to='org_only' 且 resource_permissions 里有 scope=本组织/部门/小组
  //   OR visible_to='custom' 且 resource_permissions 里有 scope=本组织/部门/小组
  let scopedWfIds: string[] | null = null;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    const tenantCode = admin.tenantCode;
    const [{ data: depts }, { data: teams }] = await Promise.all([
      db.from("departments").select("id").eq("tenant_code", tenantCode),
      db.from("teams").select("id").eq("tenant_code", tenantCode),
    ]);
    const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
    const teamIds = (teams ?? []).map((t: { id: string }) => t.id);

    const orFilters: string[] = [`and(scope_type.eq.org,scope_id.eq.${tenantCode})`];
    if (deptIds.length > 0) {
      orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
    }
    if (teamIds.length > 0) {
      orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);
    }

    const { data: scoped } = await db
      .from("resource_permissions")
      .select("resource_id")
      .eq("resource_type", "workflow")
      .or(orFilters.join(","));
    scopedWfIds = Array.from(new Set((scoped ?? []).map((r: { resource_id: string }) => r.resource_id)));

    if (scopedWfIds.length === 0) {
      // 无任何可见工作流，直接返回空
      return paginatedResponse([], 0, page, pageSize);
    }
  }

  let wfQuery = db.from("workflows")
    .select(`
      id, name, description, category, sort_order, enabled, visible_to, created_at,
      created_by, created_by_role,
      creator:created_by ( username ),
      workflow_categories ( category_id ),
      workflow_steps (
        id, step_order, title, description, exec_type, agent_id, button_text, enabled
      )
    `, { count: "exact" })
    .order("sort_order", { ascending: true })
    .range(start, start + pageSize - 1);
  if (scopedWfIds) wfQuery = wfQuery.in("id", scopedWfIds);

  const [wfRes, permRes] = await Promise.all([
    wfQuery,
    db.from("resource_permissions")
      .select("resource_id, scope_type, scope_id")
      .eq("resource_type", "workflow"),
  ]);

  if (wfRes.error) return dbError(wfRes.error);

  const permMap = new Map<string, WfPerm[]>();
  for (const p of (permRes.data ?? []) as { resource_id: string; scope_type: string; scope_id: string | null }[]) {
    const arr = permMap.get(p.resource_id) ?? [];
    arr.push({ scope_type: p.scope_type, scope_id: p.scope_id });
    permMap.set(p.resource_id, arr);
  }

  type CreatorJoin = { username: string } | null;
  const result = (wfRes.data ?? []).map((wf) => {
    const creator = wf.creator as unknown as CreatorJoin;
    return {
      ...wf,
      categoryIds: (wf.workflow_categories ?? []).map((c: { category_id: string }) => c.category_id),
      workflow_categories: undefined,
      creator: undefined,
      created_by_username: creator?.username ?? null,
      permissions: permMap.get(wf.id) ?? [],
    };
  });

  return paginatedResponse(result, wfRes.count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await req.json();
  const { name, description, category, sortOrder, enabled, categoryIds } = body;
  let { visibleTo, permissions } = body;

  if (!name) return apiError("请填写工作流名称", "VALIDATION_ERROR");

  // 5.9up · org_admin 创建工作流：
  //   - 不传 permissions（或空）→ 兼容旧行为，默认全组织可见
  //   - 传了 → 校验都在本组织范围内，按 custom 处理
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    if (!Array.isArray(permissions) || permissions.length === 0) {
      visibleTo = "org_only";
      permissions = [{ scope_type: "org", scope_id: admin.tenantCode }];
    } else {
      const result = await validateOrgAdminPermissions(admin.tenantCode, permissions);
      if (!result.ok) return apiError(result.reason, "FORBIDDEN");
      visibleTo = "custom";
    }
  }

  // 5.11up · 记录创建者（admin ID + 角色快照），用于上下级权限校验
  const adminRole = (admin.role ?? "super_admin") as "super_admin" | "system_admin" | "org_admin";
  const { data, error } = await db
    .from("workflows")
    .insert({
      name,
      description: description ?? "",
      category: category ?? "",
      sort_order: sortOrder ?? 0,
      enabled: enabled ?? true,
      visible_to: visibleTo ?? "all",
      created_by: admin.adminId,
      created_by_role: adminRole,
    })
    .select()
    .single();

  if (error) return dbError(error);

  // 插入分类关联
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    await db.from("workflow_categories").insert(
      categoryIds.map((cid: string) => ({ workflow_id: data.id, category_id: cid }))
    );
  }

  // 插入可见权限规则
  // 5.9up：上面已经把 permissions 标准化（org_admin 路径已校验），直接用
  const permsToInsert: Array<{ scope_type: string; scope_id: string | null }> = [];
  if (admin.role === "org_admin") {
    permsToInsert.push(...(permissions as Array<{ scope_type: string; scope_id: string | null }>));
  } else if (visibleTo === "custom" && Array.isArray(permissions)) {
    permsToInsert.push(...permissions);
  }
  if (permsToInsert.length > 0) {
    await db.from("resource_permissions").insert(
      permsToInsert.map((p) => ({
        resource_type: "workflow",
        resource_id: data.id,
        scope_type: p.scope_type,
        scope_id: p.scope_id,
      }))
    );
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role ?? "super_admin",
    adminTenantCode: admin.tenantCode ?? null,
    action: "create",
    resourceType: "workflow",
    resourceId: data.id,
    resourceName: name,
  });

  return NextResponse.json(data, { status: 201 });
}
