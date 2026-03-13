import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const categoryId = searchParams.get("categoryId");

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
    if (ids.length === 0) return NextResponse.json([]);

    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json([]);

  const tenantCode = user.tenantCode ?? "";

  // 权限过滤：visible_to = 'all' 或包含当前用户的 tenant_code
  const visible = (data ?? []).filter((wf) => {
    if (wf.visible_to === "all") return true;
    const allowed = wf.visible_to.split(",").map((s: string) => s.trim().toUpperCase());
    return allowed.includes(tenantCode.toUpperCase());
  });

  // 只返回有启用步骤的工作流，步骤按 step_order 排序
  const result = visible.map((wf) => ({
    ...wf,
    workflow_steps: (wf.workflow_steps ?? [])
      .filter((s: { enabled: boolean }) => s.enabled)
      .sort((a: { step_order: number }, b: { step_order: number }) => a.step_order - b.step_order),
  }));

  return NextResponse.json(result);
}
