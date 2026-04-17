import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未登录或权限已变更" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20")));
  const search = searchParams.get("search")?.trim() ?? "";
  const statusFilter = searchParams.get("status") ?? "";

  const userTypeFilter = searchParams.get("user_type") ?? "";
  const roleFilter = searchParams.get("role") ?? "";
  const deptFilter = searchParams.get("dept_id") ?? "";
  const orgFilter = searchParams.get("org") ?? "";
  // 是否包含已删除用户（默认不包含）。只有当管理员主动筛选"已删除"时才显示
  const includeDeleted = searchParams.get("includeDeleted") === "1";

  let query = db
    .from("users")
    .select(
      "id, phone, nickname, username, real_name, tenant_code, user_type, role, status, first_login, created_at, last_login_at, dept_id, team_id, departments(name), teams(name)",
      { count: "exact" }
    );

  if (search) query = query.or(`phone.ilike.%${search}%,username.ilike.%${search}%,real_name.ilike.%${search}%`);
  if (orgFilter) query = query.eq("tenant_code", orgFilter.toUpperCase());

  // 状态过滤：
  //   - 指定 statusFilter 时按它过滤
  //   - 未指定且未明确 includeDeleted 时，自动排除已删除（deleted）
  //     保留已注销（cancelled）在列表中以便管理员感知用户主动注销
  if (statusFilter && ["active", "disabled", "deleted", "cancelled"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  } else if (!includeDeleted) {
    query = query.neq("status", "deleted");
  }

  if (userTypeFilter && ["personal", "organization"].includes(userTypeFilter)) {
    query = query.eq("user_type", userTypeFilter);
  }
  if (roleFilter && ["super_admin", "system_admin", "org_admin", "user"].includes(roleFilter)) {
    query = query.eq("role", roleFilter);
  }
  if (deptFilter) query = query.eq("dept_id", deptFilter);

  // 组织管理员只能看自己组织的用户
  if (admin.role === "org_admin" && admin.tenantCode) {
    query = query.eq("tenant_code", admin.tenantCode);
  }

  // 数据库层排序 + 分页（避免全量加载到内存）
  // status 字母序：active < cancelled < deleted < disabled，cancelled/deleted 自然靠后
  // role 字母序：org_admin < super_admin < system_admin < user，近似角色优先级
  const start = (page - 1) * pageSize;
  const { data, count, error } = await query
    .order("status")
    .order("role")
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1);

  if (error) return dbError(error);

  return NextResponse.json({ data: data ?? [], pagination: { page, pageSize, total: count ?? 0 } });
}
