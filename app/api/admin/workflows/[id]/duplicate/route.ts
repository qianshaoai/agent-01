import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  // 查原工作流 + 步骤 + 分类关联
  const { data: src, error } = await db
    .from("workflows")
    .select("name, description, category, sort_order, enabled, visible_to, workflow_steps(step_order, title, description, exec_type, agent_id, button_text, enabled), workflow_categories(category_id)")
    .eq("id", id)
    .single();

  if (error || !src) return NextResponse.json({ error: "工作流不存在" }, { status: 404 });

  // 创建副本工作流
  const { data: newWf, error: wfErr } = await db
    .from("workflows")
    .insert({
      name: `${src.name}（副本）`,
      description: src.description,
      category: src.category,
      sort_order: src.sort_order,
      enabled: false,
      visible_to: src.visible_to,
    })
    .select()
    .single();

  if (wfErr || !newWf) return NextResponse.json({ error: wfErr?.message ?? "创建失败" }, { status: 500 });

  // 复制步骤
  const steps = (src.workflow_steps ?? []) as {
    step_order: number; title: string; description: string;
    exec_type: string; agent_id: string | null; button_text: string; enabled: boolean;
  }[];
  if (steps.length > 0) {
    await db.from("workflow_steps").insert(
      steps.map((s) => ({ workflow_id: newWf.id, step_order: s.step_order, title: s.title, description: s.description, exec_type: s.exec_type, agent_id: s.agent_id, button_text: s.button_text, enabled: s.enabled }))
    );
  }

  // 复制分类关联
  const cats = (src.workflow_categories ?? []) as { category_id: string }[];
  if (cats.length > 0) {
    await db.from("workflow_categories").insert(
      cats.map((c) => ({ workflow_id: newWf.id, category_id: c.category_id }))
    );
  }

  return NextResponse.json(newWf, { status: 201 });
}
