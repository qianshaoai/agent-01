import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type WfPerm = { scope_type: string; scope_id: string | null };

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

  const result = (wfRes.data ?? []).map((wf) => ({
    ...wf,
    categoryIds: (wf.workflow_categories ?? []).map((c: { category_id: string }) => c.category_id),
    workflow_categories: undefined,
    permissions: permMap.get(wf.id) ?? [],
  }));

  return paginatedResponse(result, wfRes.count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await req.json();
  const { name, description, category, sortOrder, enabled, categoryIds } = body;
  let { visibleTo, permissions } = body;

  if (!name) return apiError("请填写工作流名称", "VALIDATION_ERROR");

  // 5.7up · org_admin 创建工作流强制 visible_to='org_only' + 自动绑本组织
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    visibleTo = "org_only";
    permissions = [{ scope_type: "org", scope_id: admin.tenantCode }];
  }

  const { data, error } = await db
    .from("workflows")
    .insert({
      name,
      description: description ?? "",
      category: category ?? "",
      sort_order: sortOrder ?? 0,
      enabled: enabled ?? true,
      visible_to: visibleTo ?? "all",
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
  // org_admin 路径强制写一条 scope=本组织
  // 其它角色：仅在 visibleTo='custom' 时按提交的 permissions 写
  const permsToInsert: Array<{ scope_type: string; scope_id: string | null }> = [];
  if (admin.role === "org_admin") {
    permsToInsert.push({ scope_type: "org", scope_id: admin.tenantCode! });
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

  return NextResponse.json(data, { status: 201 });
}
