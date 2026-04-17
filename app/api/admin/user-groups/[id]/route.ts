import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;
  const { name, description } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "分组名称不能为空" }, { status: 400 });

  const { data, error } = await db
    .from("user_groups")
    .update({ name: name.trim(), description: description?.trim() ?? "" })
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;

  // 检查是否被权限配置引用
  const { count } = await db
    .from("resource_permissions")
    .select("*", { count: "exact", head: true })
    .eq("scope_type", "group")
    .eq("scope_id", id);

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `该分组还被 ${count} 条权限配置引用，请先移除相关权限后再删除` },
      { status: 409 }
    );
  }

  const { error } = await db.from("user_groups").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
