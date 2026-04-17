import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;
  const { name, sortOrder } = await req.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  const { data, error } = await db.from("departments").update(updates).eq("id", id).select().single();
  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;

  // 检查是否有用户归属此部门
  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("dept_id", id);
  if (count && count > 0) {
    return apiError(`该部门下还有 ${count} 名用户，请先移除用户再删除`, "CONFLICT");
  }

  await db.from("departments").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
