import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireAccess } from "@/lib/access-facade";
import { hasPermission } from "@/lib/permission-actor";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (ctx.role !== "super_admin") {
    const okAll = await hasPermission(ctx.actor, "user_group.read.all");
    const okOrg = ctx.tenantCode
      ? await hasPermission(ctx.actor, "user_group.read.org", [
          { scope_type: "org", scope_id: ctx.tenantCode },
        ])
      : false;
    if (!okAll && !okOrg) return apiError("权限不足", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 100);
  let query = db
    .from("user_groups")
    .select("id, name, description, tenant_code, created_at, user_group_members(count)", { count: "exact" })
    .order("created_at", { ascending: true });
  if (ctx.role !== "super_admin") {
    const okAll = await hasPermission(ctx.actor, "user_group.read.all");
    if (!okAll) {
      if (!ctx.tenantCode) return paginatedResponse([], 0, page, pageSize);
      query = query.eq("tenant_code", ctx.tenantCode);
    }
  }
  const { data, count, error } = await query.range(start, start + pageSize - 1);

  if (error) return dbError(error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (data ?? []).map((g: any) => ({
    ...g,
    member_count: g.user_group_members?.[0]?.count ?? 0,
    user_group_members: undefined,
  }));
  return paginatedResponse(result, count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { name, description, tenantCode } = await req.json();
  if (!name?.trim()) return apiError("分组名称不能为空", "VALIDATION_ERROR");
  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "user_group", "create");
    if (err) return err;
  }
  const targetTenant =
    ctx.role === "super_admin" || ctx.role === "system_admin"
      ? tenantCode || null
      : ctx.tenantCode;

  const { data, error } = await db
    .from("user_groups")
    .insert({ name: name.trim(), description: description?.trim() ?? "", tenant_code: targetTenant })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode,
    action: "create", resourceType: "user_group", resourceId: data.id, resourceName: data.name,
  });
  return NextResponse.json(data, { status: 201 });
}
