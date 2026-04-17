import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "分类名称不能为空" }, { status: 400 });

  const { data, error } = await db
    .from("wf_categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  // 检查是否有工作流使用此分类
  const { count } = await db
    .from("workflow_categories")
    .select("*", { count: "exact", head: true })
    .eq("category_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `该分类下还有 ${count} 个工作流，请先移除后再删除` }, { status: 409 });
  }

  const { error } = await db.from("wf_categories").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
