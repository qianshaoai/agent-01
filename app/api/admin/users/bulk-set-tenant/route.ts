import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase D · D-1 · user enforce（env "user" 启用时生效；空时完全 no-op）
import { isResourceEnforced } from "@/lib/access-facade";
import { hasPermission } from "@/lib/permission-actor";

export const dynamic = "force-dynamic";

const BULK_LIMIT = 200;

// 5.12up · 批量调整用户所属组织
// Body: { userIds: string[], tenantCode: string | null }
// tenantCode = null 或 'PERSONAL' → 调到个人空间
//
// 单条 RPC 失败收集到 failed[]，整体永远返回 200（前端按 succeeded/failed 长度展示结果）
export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  // org_admin 没有跨组织调动权限（与单人 set-tenant 保持一致）
  if (!ctx.isCustomAdmin && !isResourceEnforced("user") && ctx.role === "org_admin") {
    return apiError("无权批量修改用户所属组织", "FORBIDDEN");
  }

  // Phase D D-1 · v2 第二闸（env-gated）：批量跨组织调动是高权操作，要求 user.tenant.transfer.all
  if ((ctx.isCustomAdmin || isResourceEnforced("user")) && ctx.role !== "super_admin") {
    if (!(await hasPermission(ctx.actor, "user.tenant.transfer.all"))) {
      return apiError("权限不足", "FORBIDDEN");
    }
  }

  const body = await req.json().catch(() => ({}));
  const userIds: unknown = body.userIds;
  const rawTenantCode: unknown = body.tenantCode;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return apiError("userIds 必填且非空", "VALIDATION_ERROR");
  }
  if (userIds.length > BULK_LIMIT) {
    return apiError(`单次最多操作 ${BULK_LIMIT} 人`, "VALIDATION_ERROR");
  }
  if (!userIds.every((x) => typeof x === "string" && x.length > 0)) {
    return apiError("userIds 含非法值", "VALIDATION_ERROR");
  }
  // tenantCode：允许 null / 'PERSONAL'（个人）或非空字符串
  const tenantCode: string =
    rawTenantCode == null || rawTenantCode === "PERSONAL"
      ? "PERSONAL"
      : typeof rawTenantCode === "string" && rawTenantCode.trim()
      ? rawTenantCode.trim()
      : "";
  if (!tenantCode) return apiError("tenantCode 必填", "VALIDATION_ERROR");

  // 一次拉全部目标用户基础信息
  const { data: targets, error: fetchErr } = await db
    .from("users")
    .select("id, phone, nickname, status, role, tenant_code")
    .in("id", userIds as string[]);
  if (fetchErr) return apiError(fetchErr.message, "INTERNAL_ERROR");

  const targetById = new Map((targets ?? []).map((u) => [u.id, u]));

  const succeeded: Array<{ id: string; phone: string }> = [];
  const failed: Array<{ id: string; phone?: string; reason: string }> = [];

  for (const id of userIds as string[]) {
    const u = targetById.get(id);
    if (!u) {
      failed.push({ id, reason: "用户不存在" });
      continue;
    }
    if (u.status === "deleted") {
      failed.push({ id, phone: u.phone, reason: "用户已删除" });
      continue;
    }
    if (u.role === "super_admin") {
      failed.push({ id, phone: u.phone, reason: "不能移动超级管理员" });
      continue;
    }
    if (u.tenant_code === tenantCode) {
      failed.push({ id, phone: u.phone, reason: "已在目标组织内" });
      continue;
    }

    const { error: rpcErr } = await db.rpc("change_user_tenant", {
      p_user_id: id,
      p_new_tenant_code: tenantCode,
    });
    if (rpcErr) {
      failed.push({ id, phone: u.phone, reason: rpcErr.message ?? "迁移失败" });
      continue;
    }

    succeeded.push({ id, phone: u.phone });

    // 每个成功用户单独写一条 audit（标记 bulk=true 便于审计页查询）
    await writeAuditLog({
      adminId: ctx.adminId,
      adminUsername: ctx.username,
      adminRole: ctx.role,
      adminTenantCode: ctx.tenantCode ?? null,
      // 目标组织作为本条 audit 的 resourceTenantCode（迁出后 resolveResourceTenantCode 会查到新值，提前传更明确）
      resourceTenantCode: tenantCode === "PERSONAL" ? null : tenantCode,
      action: "update",
      resourceType: "user",
      resourceId: id,
      resourceName: u.nickname || u.phone,
      detail: {
        action: "set-tenant",
        bulk: true,
        tenantCode,
        fromTenantCode: u.tenant_code,
      },
    });
  }

  return NextResponse.json({ succeeded, failed });
}
