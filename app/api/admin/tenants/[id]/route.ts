import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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
  if (body.quota !== undefined) updates.quota = Number(body.quota);
  if (body.expiresAt !== undefined) updates.expires_at = body.expiresAt;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.initialPwd) {
    updates.pwd_hash = await bcrypt.hash(body.initialPwd, 12);
  }

  const { data, error } = await db
    .from("tenants")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  await db.from("tenants").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
