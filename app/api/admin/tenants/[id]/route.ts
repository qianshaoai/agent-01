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

  // 检查关联用户
  const { count: userCount } = await db
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("tenant_code", tenant.code);

  if ((userCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `该组织下还有 ${userCount} 名用户，请先删除或迁移用户后再删除组织` },
      { status: 409 }
    );
  }

  // 检查资源权限引用
  const { count: permCount } = await db
    .from("resource_permissions")
    .select("*", { count: "exact", head: true })
    .eq("scope_type", "org")
    .eq("scope_id", tenant.code);

  if ((permCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `该组织还被 ${permCount} 条权限配置引用，请先移除相关权限后再删除` },
      { status: 409 }
    );
  }

  const { error } = await db.from("tenants").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
