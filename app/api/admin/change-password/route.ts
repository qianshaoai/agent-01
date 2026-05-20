import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { signToken, buildAdminSetCookieHeader, type AdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 管理员修改自己的密码
 * - 如果是从 users 表登录的（普通用户被提升为管理员），
 *   同时会清掉 first_login 标记，完成初始密码的强制修改流程
 * - 默认 admins 表的账号也支持走此接口
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { oldPassword, newPassword } = await req.json();
  if (!newPassword || newPassword.length < 8) {
    return apiError("新密码至少 8 位", "VALIDATION_ERROR");
  }
  if (oldPassword === newPassword) {
    return apiError("新密码不能与旧密码相同", "VALIDATION_ERROR");
  }

  // 先在 users 表找（被提升为管理员的普通用户）
  const { data: user } = await db
    .from("users")
    .select("id, pwd_hash, first_login")
    .eq("id", admin.adminId)
    .single();

  // 5.13up · 改完密码写 force_relogin_at 踢其他设备；当前设备靠重发 cookie 保留会话
  // 这样 admin 改自己密码后不会被自己踢，但其他设备/浏览器的 token 立刻失效
  if (user) {
    const ok = await bcrypt.compare(oldPassword ?? "", user.pwd_hash);
    if (!ok) return apiError("旧密码错误", "UNAUTHORIZED");

    const newHash = await bcrypt.hash(newPassword, 12);
    const { error } = await db
      .from("users")
      .update({
        pwd_hash: newHash,
        first_login: false,
        force_relogin_at: new Date().toISOString(),
      })
      .eq("id", admin.adminId);
    if (error) return dbError(error);
    await writeAuditLog({
      adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
      action: "update", resourceType: "settings", resourceName: "管理员密码",
    });
    // 给当前会话发新 cookie（带更新后的 iat），保留登录态
    const newToken = await signToken({
      type: "admin",
      adminId: admin.adminId,
      username: admin.username,
      role: (admin.role as AdminRole) ?? "super_admin",
      tenantCode: admin.tenantCode ?? null,
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Set-Cookie": buildAdminSetCookieHeader(newToken) } }
    );
  }

  // 不在 users 表 → 在 admins 表
  const { data: adminRow } = await db
    .from("admins")
    .select("id, pwd_hash")
    .eq("id", admin.adminId)
    .single();

  if (!adminRow) return apiError("账号不存在", "NOT_FOUND");

  const ok = await bcrypt.compare(oldPassword ?? "", adminRow.pwd_hash);
  if (!ok) return apiError("旧密码错误", "UNAUTHORIZED");

  const newHash = await bcrypt.hash(newPassword, 12);
  const { error } = await db
    .from("admins")
    .update({
      pwd_hash: newHash,
      force_relogin_at: new Date().toISOString(),
    })
    .eq("id", admin.adminId);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "settings", resourceName: "管理员密码",
  });
  // 同样给当前会话发新 cookie，保留登录态
  const newToken = await signToken({
    type: "admin",
    adminId: admin.adminId,
    username: admin.username,
    role: (admin.role as AdminRole) ?? "super_admin",
    tenantCode: admin.tenantCode ?? null,
  });
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": buildAdminSetCookieHeader(newToken) } }
  );
}
