import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase D · D-4 · tenant enforce（env "tenant" 启用时生效；空时完全 no-op）
//   tenant 只有 .all key（平台级）；org_admin 无 tenant key、保持现有"只看本组织"行为，不套 v2 read。
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor, hasPermission } from "@/lib/permission-actor";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // Phase D D-4 · 仅对 system_admin 等非 super 非 org 用 tenant.read.all 粗闸；org_admin 走下方旧逻辑
  if (isResourceEnforced("tenant") && admin.role !== "super_admin" && admin.role !== "org_admin") {
    const actor = await buildPermissionActor(admin);
    if (!(await hasPermission(actor, "tenant.read.all"))) {
      return apiError("权限不足", "FORBIDDEN");
    }
  }

  const { page, pageSize, start } = parsePagination(req, 100);
  let query = db
    .from("tenants")
    .select("id, code, name, quota, quota_used, expires_at, enabled, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  // 5.7up · org_admin 只能看到自己组织那一行
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    query = query.eq("code", admin.tenantCode);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.7up · org_admin 不可创建组织
  if (admin.role === "org_admin") {
    return apiError("无权创建组织", "FORBIDDEN");
  }

  // Phase D D-4 · v2 第二闸 create（env-gated；tenant.create.all）
  if (isResourceEnforced("tenant") && admin.role !== "super_admin") {
    const actor = await buildPermissionActor(admin);
    const err = await requireAccess(actor, "tenant", "create");
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
  // 5.12up · tenants.pwd_hash 已废弃（早期"组织码做初始密码"流程的残留，自助注册上线后
  // 没人再读这列）。NOT NULL 约束还在，填个占位墓碑值，后续 migration 会删列。
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
    if (error.code === "23505") {
      return apiError("组织码已存在", "CONFLICT");
    }
    return dbError(error);
  }

  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "tenant", resourceId: data.id, resourceName: data.name,
    detail: { code: data.code },
  });
  return NextResponse.json(data, { status: 201 });
}
