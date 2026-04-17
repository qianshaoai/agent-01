import { dbError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type WfPerm = { scope_type: string; scope_id: string | null };

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { page, pageSize, start } = parsePagination(req, 50);
  const [wfRes, permRes] = await Promise.all([
    db.from("workflows")
      .select(`
        id, name, description, category, sort_order, enabled, visible_to, created_at,
        workflow_categories ( category_id ),
        workflow_steps (
          id, step_order, title, description, exec_type, agent_id, button_text, enabled
        )
      `, { count: "exact" })
      .order("sort_order", { ascending: true })
      .range(start, start + pageSize - 1),
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

  const { name, description, category, sortOrder, enabled, visibleTo, categoryIds, permissions } = await req.json();

  if (!name) return NextResponse.json({ error: "请填写工作流名称" }, { status: 400 });

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

  // 插入可见权限规则（仅在 custom 模式下）
  if (visibleTo === "custom" && Array.isArray(permissions) && permissions.length > 0) {
    await db.from("resource_permissions").insert(
      permissions.map((p: { scope_type: string; scope_id: string | null }) => ({
        resource_type: "workflow",
        resource_id: data.id,
        scope_type: p.scope_type,
        scope_id: p.scope_id,
      }))
    );
  }

  return NextResponse.json(data, { status: 201 });
}
