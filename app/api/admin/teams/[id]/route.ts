import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { name, sortOrder } = await req.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { data, error } = await db.from("teams").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("team_id", id);
  if (count && count > 0) {
    return NextResponse.json({ error: `该小组下还有 ${count} 名用户，请先移除用户再删除` }, { status: 409 });
  }

  await db.from("teams").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
