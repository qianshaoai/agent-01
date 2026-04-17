import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;

  const { data, error } = await db
    .from("user_group_members")
    .select("user_id, users(id, phone, username, real_name, nickname, tenant_code, user_type)")
    .eq("group_id", id);

  if (error) return dbError(error);
  return NextResponse.json((data ?? []).map((m: { user_id: string; users: unknown }) => m.users));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;
  const { userIds } = await req.json();

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return apiError("请传入 userIds 数组", "VALIDATION_ERROR");
  }

  const rows = userIds.map((uid: string) => ({ group_id: id, user_id: uid }));
  const { error } = await db.from("user_group_members").upsert(rows, { onConflict: "group_id,user_id" });
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await params;
  const { userId } = await req.json();

  const { error } = await db
    .from("user_group_members")
    .delete()
    .eq("group_id", id)
    .eq("user_id", userId);

  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
