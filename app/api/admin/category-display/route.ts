import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

// GET /api/admin/category-display?agentId=X
// 返回该智能体在所有分类下的展示状态
export async function GET(req: NextRequest) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "缺少 agentId" }, { status: 400 });

  // 所有分类
  const { data: categories } = await db
    .from("categories")
    .select("id, name")
    .order("sort_order");

  if (!categories || categories.length === 0) return NextResponse.json([]);

  const categoryIds = categories.map((c: { id: string }) => c.id);

  // 该智能体出现在哪些工作流步骤中（找到对应分类）
  const { data: steps } = await db
    .from("workflow_steps")
    .select("workflow_id")
    .eq("agent_id", agentId)
    .eq("enabled", true);

  const stepWorkflowIds = (steps ?? []).map((s: { workflow_id: string }) => s.workflow_id);

  // 这些工作流对应的分类
  const autoCategories = new Set<string>();
  if (stepWorkflowIds.length > 0) {
    const { data: wfCats } = await db
      .from("workflow_categories")
      .select("category_id")
      .in("workflow_id", stepWorkflowIds)
      .in("category_id", categoryIds);

    (wfCats ?? []).forEach((wc: { category_id: string }) => autoCategories.add(wc.category_id));
  }

  // 读取手工覆盖记录
  const { data: overrides } = await db
    .from("category_agent_display")
    .select("category_id, is_manual, is_hidden")
    .eq("agent_id", agentId)
    .in("category_id", categoryIds);

  const overrideMap = new Map<string, { is_manual: boolean; is_hidden: boolean }>();
  (overrides ?? []).forEach((o: { category_id: string; is_manual: boolean; is_hidden: boolean }) => {
    overrideMap.set(o.category_id, { is_manual: o.is_manual, is_hidden: o.is_hidden });
  });

  const result = categories.map((cat: { id: string; name: string }) => {
    const ov = overrideMap.get(cat.id) ?? { is_manual: false, is_hidden: false };
    return {
      category_id: cat.id,
      category_name: cat.name,
      is_auto: autoCategories.has(cat.id),
      is_manual: ov.is_manual,
      is_hidden: ov.is_hidden,
    };
  });

  return NextResponse.json(result);
}

// PATCH /api/admin/category-display
// 设置某智能体在某分类下的手工状态
export async function PATCH(req: NextRequest) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { agentId, categoryId, isManual, isHidden } = await req.json();
  if (!agentId || !categoryId) return NextResponse.json({ error: "缺少参数" }, { status: 400 });

  // isManual 和 isHidden 互斥：设置 hidden 时清除 manual，设置 manual 时清除 hidden
  const finalManual = isHidden ? false : (isManual ?? false);
  const finalHidden = isManual ? false : (isHidden ?? false);

  if (!finalManual && !finalHidden) {
    // 两者都关闭 → 删除记录（恢复默认）
    await db
      .from("category_agent_display")
      .delete()
      .eq("agent_id", agentId)
      .eq("category_id", categoryId);
  } else {
    await db
      .from("category_agent_display")
      .upsert(
        {
          agent_id: agentId,
          category_id: categoryId,
          is_manual: finalManual,
          is_hidden: finalHidden,
          created_at: new Date().toISOString(),
        },
        { onConflict: "category_id,agent_id" }
      );
  }

  return NextResponse.json({ ok: true });
}
