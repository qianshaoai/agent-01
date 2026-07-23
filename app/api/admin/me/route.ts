import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// 6.4up · /api/admin/me 改造
//   - 旧：仅返回 builtin admin 字段（adminId / username / role / tenantCode）
//   - 新：识别 access cookie 是 builtin 还是 custom，返回不同形态：
//       · builtin → 旧字段 + source（admin_table / user_admin）+ builtinRole
//       · custom  → source='custom_admin' + customRoleCodes + permissions（数组）+ scope ctx
//   - 该接口只服务于前端菜单 / 用户上下文展示；不是业务写权限入口
//     （写权限闸门由各业务路由的 requirePermission / requireAdmin 把关）
//
// 安全（方案 R1.2 § 入口链路扩展）：
//   - custom admin 在这里返回 builtinRole=null；前端 admin-layout 必须按 requiredPermission 过滤菜单
//   - 不把 customRoleCodes / permissions 灌回到 AdminPayload；避免 `role ?? "super_admin"` 误判风险

export async function GET() {
  const context = await requireAdminActor();
  if (context instanceof Response) return context;
  const { actor } = context;

  if (context.isCustomAdmin) {
    return NextResponse.json({
      source: "custom_admin",
      userId: actor.actorId,
      username: actor.username,
      builtinRole: null,
      tenantCode: actor.tenantCode,
      deptId: actor.deptId,
      teamId: actor.teamId,
      userType: actor.userType,
      customRoleCodes: actor.customRoleCodes,
      permissions: Array.from(actor.permissions),
      // 兼容旧字段名（admin-layout 与下拉徽章会同时看 role 字段决定标签）
      role: null,
      adminId: null,
    });
  }

  return NextResponse.json({
    source: context.source,
    adminId: actor.actorId,
    username: actor.username,
    role: actor.builtinRole ?? "super_admin",
    builtinRole: actor.builtinRole,
    tenantCode: actor.tenantCode,
    deptId: actor.deptId,
    teamId: actor.teamId,
    userType: actor.userType,
    customRoleCodes: [],
    permissions: Array.from(actor.effectivePermissions),
  });
}
