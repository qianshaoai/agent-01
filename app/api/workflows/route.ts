import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

  // 硬上限 500，防止组织规模过大时前台一次拉取过量数据
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
    .order("sort_order", { ascending: true })
    .limit(500);

  // 如果指定了分类，先查出属于该分类的工作流 ID
  if (categoryId && categoryId !== "__all__") {
    const { data: links } = await db
      .from("workflow_categories")
      .select("workflow_id")
      .eq("category_id", categoryId);

    const ids = (links ?? []).map((l: { workflow_id: string }) => l.workflow_id);
    if (ids.length === 0) return NextResponse.json([]);

    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json([]);

  const tenantCode = user.tenantCode ?? "";
  const isPersonal = user.isPersonal ?? !tenantCode;
  const workflows = data ?? [];

  // 需要查权限表的工作流 ID（visible_to === 'custom' 或旧的逗号分隔格式）
  const customIds = workflows
    .filter((wf) => {
      if (!wf.visible_to) return false;
      return wf.visible_to === "custom" || !["all", "org_only", "personal_only"].includes(wf.visible_to);
    })
    .map((wf) => wf.id);

  // 取当前用户的 dept_id / team_id（可能为空）
  let userDeptId: string | null = null;
  let userTeamId: string | null = null;
  if (!isPersonal) {
    const { data: userRow } = await db
      .from("users")
      .select("dept_id, team_id")
      .eq("id", user.userId)
      .single();
    userDeptId = userRow?.dept_id ?? null;
    userTeamId = userRow?.team_id ?? null;
  }

  // 批量查询这些 custom 工作流的权限规则
  const permMap = new Map<string, { scope_type: string; scope_id: string | null }[]>();
  if (customIds.length > 0) {
    const { data: perms } = await db
      .from("resource_permissions")
      .select("resource_id, scope_type, scope_id")
      .eq("resource_type", "workflow")
      .in("resource_id", customIds);
    for (const p of (perms ?? []) as { resource_id: string; scope_type: string; scope_id: string | null }[]) {
      const arr = permMap.get(p.resource_id) ?? [];
      arr.push({ scope_type: p.scope_type, scope_id: p.scope_id });
      permMap.set(p.resource_id, arr);
    }
  }

  // 权限过滤
  const visible = workflows.filter((wf) => {
    if (wf.visible_to === "all") return true;
    if (wf.visible_to === "org_only") return !isPersonal;
    if (wf.visible_to === "personal_only") return isPersonal;

    // custom 模式：查权限规则
    if (wf.visible_to === "custom") {
      const rules = permMap.get(wf.id) ?? [];
      if (rules.length === 0) return false;  // custom 但没规则 → 不可见
      return rules.some((r) => {
        switch (r.scope_type) {
          case "all": return true;
          case "org":  return !!tenantCode && r.scope_id === tenantCode;
          case "dept": return !!userDeptId && r.scope_id === userDeptId;
          case "team": return !!userTeamId && r.scope_id === userTeamId;
          case "user_type": return r.scope_id === (isPersonal ? "personal" : "organization");
          case "user": return r.scope_id === user.userId;
          default: return false;
        }
      });
    }

    // 兼容旧数据：逗号分隔的组织码（未迁移到 custom + resource_permissions 的情况）
    const allowed = wf.visible_to.split(",").map((s: string) => s.trim().toUpperCase()).filter(Boolean);
    return allowed.includes(tenantCode.toUpperCase());
  });

  const result = visible.map((wf) => ({
    ...wf,
    workflow_steps: (wf.workflow_steps ?? [])
      .filter((s: { enabled: boolean }) => s.enabled)
      .sort((a: { step_order: number }, b: { step_order: number }) => a.step_order - b.step_order),
  }));

  return NextResponse.json(result);
}
