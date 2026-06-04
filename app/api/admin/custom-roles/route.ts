/**
 * 6.4up · 权限管理 · 自定义角色 CRUD（list / create）
 *
 * 权限（方案 R1.2 决策 2 / 决策 10）：
 *   - 仅 super_admin 可调用（list/create/update/delete 全部）
 *   - POST：permission_keys 必须全部命中 PERMISSION_KEYS 常量
 *   - POST：任一 .all 后缀必须由 super_admin 授予（当前已硬约束 super_admin only，
 *           此处仍写一道显式校验作为防御深度 —— 万一未来放权也不会破规）
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { requireAdmin } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import {
  isPermissionKey,
  requiresSuperAdminToGrant,
  PermissionKey,
} from "@/lib/permission-keys";

export const dynamic = "force-dynamic";

function requireSuper(role: string): Response | null {
  if (role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");
  return null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const [{ data: roles, error: rolesErr }, { data: perms, error: permsErr }] =
    await Promise.all([
      db.from("custom_roles").select("id, name, code, description, enabled, created_at, updated_at").order("created_at", { ascending: true }),
      db.from("custom_role_permissions").select("role_id, permission_key"),
    ]);
  if (rolesErr) return dbError(rolesErr);
  if (permsErr) return dbError(permsErr);

  const permMap = new Map<string, string[]>();
  for (const p of (perms ?? []) as { role_id: string; permission_key: string }[]) {
    const arr = permMap.get(p.role_id) ?? [];
    arr.push(p.permission_key);
    permMap.set(p.role_id, arr);
  }

  // 顺手回带每个 role 的"用户数"（前端 UI 用，避免每行再发请求）
  const { data: userBindings } = await db
    .from("user_custom_roles")
    .select("role_id");
  const userCountMap = new Map<string, number>();
  for (const b of (userBindings ?? []) as { role_id: string }[]) {
    userCountMap.set(b.role_id, (userCountMap.get(b.role_id) ?? 0) + 1);
  }

  const result = (roles ?? []).map((r) => ({
    ...r,
    permissions: permMap.get(r.id) ?? [],
    user_count: userCountMap.get(r.id) ?? 0,
  }));
  return NextResponse.json({ data: result });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const body = await req.json();
  const { name, code, description, enabled, permissions } = body as {
    name?: string;
    code?: string;
    description?: string;
    enabled?: boolean;
    permissions?: unknown[];
  };

  if (!name || typeof name !== "string") return apiError("请填写角色名称", "VALIDATION_ERROR");
  if (!code || typeof code !== "string") return apiError("请填写角色 code", "VALIDATION_ERROR");
  if (!/^[a-z][a-z0-9_]*$/.test(code)) {
    return apiError("角色 code 仅允许小写字母 + 数字 + 下划线，且首字符为字母", "VALIDATION_ERROR");
  }

  // permissions 校验
  const validKeys: PermissionKey[] = [];
  for (const k of permissions ?? []) {
    if (!isPermissionKey(k)) {
      return apiError(`权限项 ${String(k)} 不在合法清单中`, "VALIDATION_ERROR");
    }
    if (requiresSuperAdminToGrant(k) && admin.role !== "super_admin") {
      return apiError(`权限 ${k} 仅超级管理员可授予`, "FORBIDDEN");
    }
    if (!validKeys.includes(k)) validKeys.push(k);
  }

  // 检查名称 / code 唯一性（DB 已有 UNIQUE，但前置一次给更清晰的报错）
  const { data: existing } = await db
    .from("custom_roles")
    .select("id, name, code")
    .or(`name.eq.${name},code.eq.${code}`)
    .limit(1);
  if (existing && existing.length > 0) {
    const dup = existing[0] as { name: string; code: string };
    return apiError(
      dup.name === name ? `角色名称「${name}」已存在` : `角色 code「${code}」已被占用`,
      "VALIDATION_ERROR",
    );
  }

  const { data: created, error: createErr } = await db
    .from("custom_roles")
    .insert({
      name,
      code,
      description: description ?? "",
      enabled: enabled ?? true,
      created_by: admin.adminId,
    })
    .select("id, name, code")
    .single();
  if (createErr || !created) return dbError(createErr ?? new Error("创建失败"));

  if (validKeys.length > 0) {
    const { error: permInsertErr } = await db
      .from("custom_role_permissions")
      .insert(validKeys.map((k) => ({ role_id: created.id, permission_key: k })));
    if (permInsertErr) {
      // 回滚已创建的 role（无事务支持，只能尽力清理）
      await db.from("custom_roles").delete().eq("id", created.id);
      return dbError(permInsertErr);
    }
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "create",
    resourceType: "custom_role",
    resourceId: created.id,
    resourceName: name,
    detail: { code, permissions: validKeys },
  });

  return NextResponse.json({ data: { id: created.id, name, code, permissions: validKeys } }, { status: 201 });
}
