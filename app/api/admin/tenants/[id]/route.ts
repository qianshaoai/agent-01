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

  // 查出组织码
  const { data: tenant } = await db.from("tenants").select("code, name").eq("id", id).single();
  if (!tenant) return NextResponse.json({ error: "组织不存在" }, { status: 404 });

  // ── 只统计「有效用户」：active / disabled ────────────────────────
  // deleted / cancelled 都属于软删除，对管理员来说已经不可见，不应阻止组织删除
  const { count: activeUserCount } = await db
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("tenant_code", tenant.code)
    .in("status", ["active", "disabled"]);

  if ((activeUserCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `该组织下还有 ${activeUserCount} 名有效用户，请先删除或迁移用户后再删除组织` },
      { status: 409 }
    );
  }

  // ── 级联清理：把该组织下所有软删除用户（deleted/cancelled）一并真删 ─
  //   因为这些用户本来就已经"不存在"，组织没了它们没任何意义
  await db
    .from("users")
    .delete()
    .eq("tenant_code", tenant.code)
    .in("status", ["deleted", "cancelled"]);

  // ── 级联清理：该组织相关的权限规则（scope_type=org）失去意义 ────
  await db
    .from("resource_permissions")
    .delete()
    .eq("scope_type", "org")
    .eq("scope_id", tenant.code);

  // ── 级联清理：部门/小组（外键 ON DELETE CASCADE 已配置）────────
  //   tenant 删除时 departments 会自动级联，teams 会跟着 departments 级联

  const { error } = await db.from("tenants").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
