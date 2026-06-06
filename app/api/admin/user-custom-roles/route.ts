/**
 * 6.4up · 权限管理 · 给用户授予 / 撤销 custom role
 *
 * 仅 super_admin 可调用（同 custom-roles 全栈一致）。
 *
 * 接口：
 *   - POST   { user_id, role_id } → 授予
 *   - DELETE { user_id, role_id } → 撤销
 *
 * 安全：
 *   - 校验 user 存在且 status='active'
 *   - 校验 role 存在且 enabled=true
 *   - 不允许把 custom role 挂到 builtin admin（role∈3档）—— 方案决策 4：admin 走原 RBAC
 *   - 全部写 audit_logs(resource_type='custom_role', action='update', detail={granted: …, user: …})
 *     不另开 'grant' / 'revoke' action，复用 update —— 与 audit.ts AuditAction 现有 enum 对齐
 *     避免改 audit_logs.action CHECK 约束
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";
import { requireAdmin } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

function requireSuper(role: string): Response | null {
  if (role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");
  return null;
}

async function validateUserAndRole(
  userId: string,
  roleId: string,
): Promise<{ ok: true; userRow: { id: string; username: string | null; phone: string; role: string }; roleRow: { id: string; name: string; code: string } } | { ok: false; resp: Response }> {
  const [{ data: userRow }, { data: roleRow }] = await Promise.all([
    db.from("users").select("id, username, phone, status, role").eq("id", userId).maybeSingle(),
    db.from("custom_roles").select("id, name, code, enabled").eq("id", roleId).maybeSingle(),
  ]);
  if (!userRow) return { ok: false, resp: apiError("用户不存在", "NOT_FOUND") };
  if ((userRow as { status: string }).status !== "active") {
    return { ok: false, resp: apiError("用户状态非 active，禁止授予角色", "FORBIDDEN") };
  }
  if (!roleRow) return { ok: false, resp: apiError("角色不存在", "NOT_FOUND") };
  if (!(roleRow as { enabled: boolean }).enabled) {
    return { ok: false, resp: apiError("该角色已停用，无法授予", "FORBIDDEN") };
  }
  // 不允许给 builtin admin（role∈3档）挂 custom role —— 方案决策 4
  const builtinRoles = ["super_admin", "system_admin", "org_admin"];
  if (builtinRoles.includes((userRow as { role: string }).role)) {
    return {
      ok: false,
      resp: apiError("内置管理员不挂 custom role；如需调整，请改用户的 builtin role", "FORBIDDEN"),
    };
  }
  return { ok: true, userRow: userRow as { id: string; username: string | null; phone: string; role: string }, roleRow: roleRow as { id: string; name: string; code: string } };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  const body = await req.json();
  const userId: string | undefined = body?.user_id;
  const roleId: string | undefined = body?.role_id;
  if (!userId || !roleId) return apiError("缺少 user_id / role_id", "VALIDATION_ERROR");

  const v = await validateUserAndRole(userId, roleId);
  if (!v.ok) return v.resp;

  // 幂等：已绑定 → 直接返回 ok（不视为错误）
  const { data: existing } = await db
    .from("user_custom_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role_id", roleId)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, already_granted: true });

  const { error: insErr } = await db.from("user_custom_roles").insert({
    user_id: userId,
    role_id: roleId,
    granted_by: admin.adminId,
  });
  if (insErr) return dbError(insErr);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "custom_role",
    resourceId: roleId,
    resourceName: v.roleRow.name,
    detail: {
      event: "grant",
      user_id: userId,
      user_label: v.userRow.username ?? v.userRow.phone,
      role_code: v.roleRow.code,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const guard = requireSuper(admin.role);
  if (guard) return guard;

  // DELETE 没 body 时支持 query string；兼容两种
  const url = new URL(req.url);
  let userId = url.searchParams.get("user_id");
  let roleId = url.searchParams.get("role_id");
  if (!userId || !roleId) {
    try {
      const body = await req.json();
      userId = userId ?? body?.user_id;
      roleId = roleId ?? body?.role_id;
    } catch {
      // ignore — body 可能为空
    }
  }
  if (!userId || !roleId) return apiError("缺少 user_id / role_id", "VALIDATION_ERROR");

  const [{ data: roleRow }, { data: userRow }] = await Promise.all([
    db.from("custom_roles").select("id, name, code").eq("id", roleId).maybeSingle(),
    db.from("users").select("id, username, phone").eq("id", userId).maybeSingle(),
  ]);

  const { error: delErr } = await db
    .from("user_custom_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role_id", roleId);
  if (delErr) return dbError(delErr);

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "update",
    resourceType: "custom_role",
    resourceId: roleId,
    resourceName: (roleRow as { name?: string } | null)?.name ?? "(已删除)",
    detail: {
      event: "revoke",
      user_id: userId,
      user_label: (userRow as { username?: string; phone?: string } | null)?.username ?? (userRow as { phone?: string } | null)?.phone ?? null,
      role_code: (roleRow as { code?: string } | null)?.code,
    },
  });

  return NextResponse.json({ ok: true });
}
