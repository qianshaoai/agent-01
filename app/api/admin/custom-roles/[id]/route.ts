/**
 * 6.4up · 权限管理 · 自定义角色单项 CRUD（read / update / delete）
 *
 * 权限：仅 super_admin（同 list/create 路由）。
 *
 * PATCH 行为：
 *   - 显式字段（name / code / description / enabled）按业务规则单独 update
 *   - permissions 字段一旦传入（无论数组是否为空）→ 全量替换该角色的 permission set
 *     · 任一 .all 后缀必须由 super_admin 授予（防御深度，当前路由已 super_admin only）
 *     · 全部 key 必须命中 PERMISSION_KEYS
 *
 * DELETE 行为：
 *   - CASCADE 删 custom_role_permissions 与 user_custom_roles 行
 *   - 决策点 6：撤销 role 不影响已建资源（workflow.created_by_role_code 留作历史快照）
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { requireAdmin } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import {
  isCustomRolePermissionKey,
  requiresSuperAdminToGrant,
  CustomRolePermissionKey,
} from "@/lib/permission-keys";

// 6.6up · custom roles 从 workflow-only 升级为后台全资源权限。
const isPermissionKey = isCustomRolePermissionKey;

export const dynamic = "force-dynamic";

function requireSuper(role: string): Response | null {
  if (role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { id } = await params;
  const [{ data: role, error: roleErr }, { data: perms }, { data: bindings }] =
    await Promise.all([
      db.from("custom_roles").select("*").eq("id", id).maybeSingle(),
      db.from("custom_role_permissions").select("permission_key").eq("role_id", id),
      db.from("user_custom_roles").select("user_id, granted_at, granted_by").eq("role_id", id),
    ]);
  if (roleErr) return dbError(roleErr);
  if (!role) return apiError("角色不存在", "NOT_FOUND");

  return NextResponse.json({
    data: {
      ...role,
      permissions: (perms ?? []).map((p: { permission_key: string }) => p.permission_key),
      bindings: bindings ?? [],
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { id } = await params;
  const body = await req.json();
  const { name, code, description, enabled, permissions } = body as {
    name?: string;
    code?: string;
    description?: string;
    enabled?: boolean;
    permissions?: unknown[];
  };

  const { data: existing } = await db
    .from("custom_roles")
    .select("id, name, code")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiError("角色不存在", "NOT_FOUND");

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name) return apiError("角色名称非法", "VALIDATION_ERROR");
    updates.name = name;
  }
  if (code !== undefined) {
    if (typeof code !== "string" || !/^[a-z][a-z0-9_]*$/.test(code)) {
      return apiError("角色 code 仅允许小写字母 + 数字 + 下划线", "VALIDATION_ERROR");
    }
    updates.code = code;
  }
  if (description !== undefined) updates.description = String(description ?? "");
  if (enabled !== undefined) updates.enabled = !!enabled;
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await db.from("custom_roles").update(updates).eq("id", id);
    if (updErr) return dbError(updErr);
  }

  // 6.6up · permissions 全量替换：严校 CUSTOM_ROLE_PERMISSION_KEYS
  let validKeys: CustomRolePermissionKey[] | null = null;
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) return apiError("permissions 必须是数组", "VALIDATION_ERROR");
    validKeys = [];
    for (const k of permissions) {
      if (!isPermissionKey(k)) {
        return apiError(`权限项 ${String(k)} 不在自定义角色合法清单中`, "VALIDATION_ERROR");
      }
      if (requiresSuperAdminToGrant(k) && admin.role !== "super_admin") {
        return apiError(`权限 ${k} 仅超级管理员可授予`, "FORBIDDEN");
      }
      if (!validKeys.includes(k)) validKeys.push(k);
    }
    await db.from("custom_role_permissions").delete().eq("role_id", id);
    if (validKeys.length > 0) {
      const { error: permErr } = await db
        .from("custom_role_permissions")
        .insert(validKeys.map((k) => ({ role_id: id, permission_key: k })));
      if (permErr) return dbError(permErr);
    }
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "custom_role",
    resourceId: id,
    resourceName: name ?? (existing as { name: string }).name,
    detail: {
      updates,
      ...(validKeys !== null ? { permissions: validKeys } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const { id } = await params;
  const { data: existing } = await db
    .from("custom_roles")
    .select("id, name, code")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiError("角色不存在", "NOT_FOUND");

  // CASCADE FK 会自动清理 custom_role_permissions / user_custom_roles
  const { error: delErr } = await db.from("custom_roles").delete().eq("id", id);
  if (delErr) return dbError(delErr);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "delete",
    resourceType: "custom_role",
    resourceId: id,
    resourceName: (existing as { name: string }).name,
    detail: { code: (existing as { code: string }).code },
  });

  return NextResponse.json({ ok: true });
}
