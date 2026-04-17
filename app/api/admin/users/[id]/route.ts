import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { canAssignRole, canManageTarget } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const body = await req.json();

  // 加载目标用户当前信息，用于权限校验
  const { data: target } = await db
    .from("users")
    .select("id, role, status, tenant_code, user_type")
    .eq("id", id)
    .single();
  if (!target) return apiError("用户不存在", "NOT_FOUND");

  // 组织管理员只能管理自己组织内的用户
  if (admin.role === "org_admin") {
    if (!admin.tenantCode || target.tenant_code !== admin.tenantCode) {
      return apiError("无权操作该用户（不在你的组织内）", "FORBIDDEN");
    }
  }

  // 对"管理"类动作：需要 actor 层级高于 target 当前角色
  const MANAGE_ACTIONS = ["set-status", "set-dept", "reset-password", "soft-delete", "delete"];
  if (MANAGE_ACTIONS.includes(body.action)) {
    if (!canManageTarget(admin.role, target.role)) {
      return apiError("无权管理该用户（对方等级不低于你）", "FORBIDDEN");
    }
  }

  // ── 修改账号状态 ────────────────────────────────────────
  if (body.action === "set-status") {
    const { status } = body;
    if (!["active", "disabled"].includes(status)) {
      return apiError("状态值无效", "VALIDATION_ERROR");
    }
    const { error } = await db.from("users").update({ status }).eq("id", id);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  // ── 修改角色 ────────────────────────────────────────────
  if (body.action === "set-role") {
    const { role } = body;
    if (!["super_admin", "system_admin", "org_admin", "user"].includes(role)) {
      return apiError("角色值无效", "VALIDATION_ERROR");
    }
    if (target.status === "deleted") {
      return apiError("该用户已删除，不能修改角色", "VALIDATION_ERROR");
    }
    // 业务校验：个人用户不能被设为组织管理员（组织管理员必须归属某个组织）
    if (role === "org_admin") {
      if (target.user_type === "personal" || !target.tenant_code || target.tenant_code === "PERSONAL") {
        return NextResponse.json(
          { error: "个人用户不能被设为组织管理员，请先将该用户加入组织" },
          { status: 400 }
        );
      }
    }
    // 越权校验：
    //   1) 不能修改跟自己同级或更高级别的人
    //   2) 不能把别人改成 >= 自己的角色
    if (!canManageTarget(admin.role, target.role)) {
      return apiError("无权修改该用户的角色（对方等级不低于你）", "FORBIDDEN");
    }
    if (!canAssignRole(admin.role, role, admin.adminId === id)) {
      return apiError("无权将用户设置为该角色（不能高于或等于自己）", "FORBIDDEN");
    }
    const { error } = await db.from("users").update({ role }).eq("id", id);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  // ── 分配部门/小组 ────────────────────────────────────────
  if (body.action === "set-dept") {
    const { deptId, teamId } = body;
    const updates: Record<string, unknown> = {
      dept_id: deptId || null,
      team_id: teamId || null,
    };
    const { error } = await db.from("users").update(updates).eq("id", id);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  // ── 重置密码 ────────────────────────────────────────────
  if (body.action === "reset-password") {
    const { newPassword } = body;
    if (!newPassword || newPassword.length < 8) {
      return apiError("新密码至少 8 位", "VALIDATION_ERROR");
    }
    const pwd_hash = await bcrypt.hash(newPassword, 12);
    const { error } = await db
      .from("users")
      .update({ pwd_hash, first_login: true })
      .eq("id", id);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  // ── 删除用户（硬删除，不再沿用"已注销"语义）──────────────
  //   为了保证数据安全，仍采用 status=deleted 软删除，
  //   但列表查询会过滤掉这些行，对上层等同于"删除"。
  if (body.action === "soft-delete" || body.action === "delete") {
    const { error } = await db.from("users").update({ status: "deleted" }).eq("id", id);
    if (error) return dbError(error);
    return NextResponse.json({ ok: true });
  }

  return apiError("未知操作", "VALIDATION_ERROR");
}
