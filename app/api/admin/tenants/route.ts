import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { requireAccess } from "@/lib/access-facade";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permission-actor";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const canReadAll = ctx.role === "super_admin" || await hasPermission(ctx.actor, "tenant.read.all");
  if (!canReadAll) return apiError("权限不足", "FORBIDDEN");

  const { page, pageSize, start } = parsePagination(req, 100);
  let query = db
    .from("tenants")
    .select("id, code, name, quota, quota_used, expires_at, enabled, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (ctx.role === "org_admin") {
    if (!ctx.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    query = query.eq("code", ctx.tenantCode);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "tenant", "create");
    if (err) return err;
  }

  const { code, name, quota, expiresAt } = await req.json();
  if (!code || !name || !quota || !expiresAt) {
    return apiError("请填写所有必填字段", "VALIDATION_ERROR");
  }

  if (!/^[A-Za-z]{4,8}$/.test(code.trim())) {
    return apiError("组织码只能为 4~8 位英文字母", "VALIDATION_ERROR");
  }

  const normalizedCode = code.trim().toUpperCase();
  const pwdHash = "deprecated:tenant-pwd-no-longer-used";

  const { data, error } = await db
    .from("tenants")
    .insert({
      code: normalizedCode,
      name,
      pwd_hash: pwdHash,
      quota: Number(quota),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return apiError("组织码已存在", "CONFLICT");
    return dbError(error);
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "create",
    resourceType: "tenant",
    resourceId: data.id,
    resourceName: data.name,
    detail: { code: data.code },
  });
  return NextResponse.json(data, { status: 201 });
}
