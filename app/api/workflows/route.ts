import { NextRequest, NextResponse } from "next/server";
import { requireFullUser } from "@/lib/auth";
import { getActiveUser } from "@/lib/session";
import { db } from "@/lib/db";
import { buildVisibilityCtx, filterVisibleWorkflows } from "@/lib/workflow-visibility";

export const dynamic = "force-dynamic";

// R1.5 · 强制浏览器层不缓存
// 起因：dynamic="force-dynamic" 只保证服务端不缓存；但前端用普通 fetch("/api/workflows")
// 时，浏览器会按 HTTP 启发式缓存返回旧响应，导致管理员改了用户 dept/team 后
// F5 软刷新仍看旧排序（必须 Ctrl+Shift+R 或重新登录）。这里在 server 响应直接
// 声明 no-store，避免任何调用方踩这个坑（前端 fetch 也会显式标注 no-store）。
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" } as const;

export async function GET(req: NextRequest) {
  // 5.7up · 用 getActiveUser（DB-fresh role）而非 getCurrentUser（JWT 快照）
  // 这样 admin 改完用户 role 后，用户**刷新即可切换**可见工作流，无需重登
  const user = await getActiveUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401, headers: NO_STORE_HEADERS });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

  // 6.3up R1.2 Finding 2 修复：去掉 .limit(500)。
  // 旧版在可见性过滤 + scope 排序前就按全局 sort_order 截断 500 条，导致
  // 团队/部门排序靠前但全局排在 500 名外的工作流永远出不来。
  // 业务上 enabled 工作流总量在百级，全量拉的成本可接受；未来真到上千级再上分页。
  let query = db
    .from("workflows")
    .select(`
      id, name, description, category, sort_order, visible_to,
      workflow_steps (
        id, step_order, title, description, exec_type, agent_id, button_text, enabled,
        agents ( id, agent_code, name, agent_type, external_url )
      )
    `)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  // 如果指定了分类，先查出属于该分类的工作流 ID
  if (categoryId && categoryId !== "__all__") {
    const { data: links } = await db
      .from("workflow_categories")
      .select("workflow_id")
      .eq("category_id", categoryId);

    const ids = (links ?? []).map((l: { workflow_id: string }) => l.workflow_id);
    if (ids.length === 0) return NextResponse.json([], { headers: NO_STORE_HEADERS });

    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json([], { headers: NO_STORE_HEADERS });

  const workflows = data ?? [];

  // 6.3up R1.1 · 统一可见性 helper（顶替原 5.7up org_admin 豁免 + 各 visible_to 判定）
  // helper 内含：system_admin 全放行 / org_admin 本组织豁免 / all/org_only/custom/personal_only
  //   /旧逗号分隔租户码 兼容；org_only 改为查 permissions（修复跨组织泄露）。
  const ctx = await buildVisibilityCtx(user);
  const visibleIds = await filterVisibleWorkflows(
    workflows.map((wf) => ({ id: wf.id, visible_to: wf.visible_to ?? null })),
    ctx
  );

  // 6.3up R1.1 · Phase 4 · 层级排序回退（team > dept > org > workflows.sort_order）
  // system_admin 跳过排序（保持现状全量按 workflows.sort_order）；其它角色调 RPC。
  const scopeOrderMap = new Map<string, number>();
  if (user.role !== "system_admin") {
    const { data: orderRows } = await db.rpc("get_user_workflow_order", { p_user_id: user.userId });
    for (const row of (orderRows ?? []) as { workflow_id: string; sort_order: number }[]) {
      scopeOrderMap.set(row.workflow_id, row.sort_order);
    }
  }

  const visible = workflows.filter((wf) => visibleIds.has(wf.id));

  // 最终排序：COALESCE(scope_order, workflows.sort_order, 999999) ASC, id ASC
  visible.sort((a, b) => {
    const aOrder = scopeOrderMap.get(a.id) ?? a.sort_order ?? 999999;
    const bOrder = scopeOrderMap.get(b.id) ?? b.sort_order ?? 999999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const result = visible.map((wf) => ({
    ...wf,
    workflow_steps: (wf.workflow_steps ?? [])
      .filter((s: { enabled: boolean }) => s.enabled)
      .sort((a: { step_order: number }, b: { step_order: number }) => a.step_order - b.step_order),
  }));

  return NextResponse.json(result, { headers: NO_STORE_HEADERS });
}
