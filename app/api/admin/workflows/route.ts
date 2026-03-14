import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data, error } = await db
    .from("workflows")
    .select(`
      id, name, description, category, sort_order, enabled, visible_to, created_at,
      workflow_categories ( category_id ),
      workflow_steps (
        id, step_order, title, description, exec_type, agent_id, button_text, enabled
      )
    `)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 将 workflow_categories 转为 categoryIds 数组
  const result = (data ?? []).map((wf) => ({
    ...wf,
    categoryIds: (wf.workflow_categories ?? []).map((c: { category_id: string }) => c.category_id),
    workflow_categories: undefined,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { name, description, category, sortOrder, enabled, visibleTo, categoryIds } = await req.json();

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 插入分类关联
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    await db.from("workflow_categories").insert(
      categoryIds.map((cid: string) => ({ workflow_id: data.id, category_id: cid }))
    );
  }

  return NextResponse.json(data, { status: 201 });
}
