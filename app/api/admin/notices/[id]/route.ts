import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  // org_admin 权限校验：只能操作自己组织的公告
  if (admin.role === "org_admin") {
    const { data: notice } = await db.from("notices").select("tenant_code").eq("id", id).single();
    if (!notice) return NextResponse.json({ error: "公告不存在" }, { status: 404 });
    if (!notice.tenant_code || notice.tenant_code !== admin.tenantCode) {
      return NextResponse.json({ error: "无权修改该公告" }, { status: 403 });
    }
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.content !== undefined) updates.content = body.content;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  // org_admin 不允许修改 tenantCode（防止改成全局公告）
  if (body.tenantCode !== undefined && admin.role !== "org_admin") {
    updates.tenant_code = body.tenantCode || null;
  }

  const { data, error } = await db
    .from("notices")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;

  // org_admin 权限校验：只能删除自己组织的公告
  if (admin.role === "org_admin") {
    const { data: notice } = await db.from("notices").select("tenant_code").eq("id", id).single();
    if (!notice) return NextResponse.json({ error: "公告不存在" }, { status: 404 });
    if (!notice.tenant_code || notice.tenant_code !== admin.tenantCode) {
      return NextResponse.json({ error: "无权删除该公告" }, { status: 403 });
    }
  }

  await db.from("notices").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
