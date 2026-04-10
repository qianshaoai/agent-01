import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

  // 先取全部符合过滤的记录，在内存中按 角色+时间 排序后手动分页
  // （用户量在后台管理场景下可控，通常 < 数千，这里取上限 5000 作为安全护栏）
  const { data, count, error } = await query.limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const roleRank: Record<string, number> = {
    super_admin: 0,
    system_admin: 1,
    org_admin: 2,
    user: 3,
  };
  const sorted = (data ?? []).slice().sort((a, b) => {
    // 1. 已注销（cancelled）/ 已删除（deleted）沉底
    const aBad = (a.status === "cancelled" || a.status === "deleted") ? 1 : 0;
    const bBad = (b.status === "cancelled" || b.status === "deleted") ? 1 : 0;
    if (aBad !== bBad) return aBad - bBad;
    // 2. 按角色排序
    const ar = roleRank[a.role] ?? 99;
    const br = roleRank[b.role] ?? 99;
    if (ar !== br) return ar - br;
    // 3. 时间倒序
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const total = count ?? sorted.length;
  const start = (page - 1) * pageSize;
  const pageData = sorted.slice(start, start + pageSize);

  return NextResponse.json({ users: pageData, total, page, pageSize });
}
