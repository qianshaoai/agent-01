import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireAccess } from "@/lib/access-facade";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "user_group", "read", { id });
    if (err) return err;
  }

  const { data, error } = await db
    .from("user_group_members")
    .select("user_id, users(id, phone, username, real_name, nickname, tenant_code, user_type)")
    .eq("group_id", id);

  if (error) return dbError(error);
  return NextResponse.json((data ?? []).map((m: { user_id: string; users: unknown }) => m.users));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "user_group", "update", { id });
    if (err) return err;
  }
  const { userIds } = await req.json();

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return apiError("请传入 userIds 数组", "VALIDATION_ERROR");
  }

  const rows = userIds.map((uid: string) => ({ group_id: id, user_id: uid }));
  const { error } = await db.from("user_group_members").upsert(rows, { onConflict: "group_id,user_id" });
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode,
    action: "update", resourceType: "user_group", resourceId: id,
    detail: { action: "add-members", userIds },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "user_group", "update", { id });
    if (err) return err;
  }
  const { userId } = await req.json();

  const { error } = await db
    .from("user_group_members")
    .delete()
    .eq("group_id", id)
    .eq("user_id", userId);

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode,
    action: "update", resourceType: "user_group", resourceId: id,
    detail: { action: "remove-member", userId },
  });
  return NextResponse.json({ ok: true });
}
