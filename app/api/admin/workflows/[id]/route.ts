import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.visibleTo !== undefined) updates.visible_to = body.visibleTo;

  const { data, error } = await db
    .from("workflows")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 更新分类关联（全量替换）
  if (Array.isArray(body.categoryIds)) {
    await db.from("workflow_categories").delete().eq("workflow_id", id);
    if (body.categoryIds.length > 0) {
      await db.from("workflow_categories").insert(
        body.categoryIds.map((cid: string) => ({ workflow_id: id, category_id: cid }))
      );
    }
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { error } = await db.from("workflows").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
