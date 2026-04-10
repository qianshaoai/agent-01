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

  let query = db
    .from("users")
    .select(
      "id, phone, nickname, username, real_name, tenant_code, user_type, role, status, first_login, created_at, last_login_at, dept_id, team_id, departments(name), teams(name)",
      { count: "exact" }
    );

  if (search) query = query.or(`phone.ilike.%${search}%,username.ilike.%${search}%,real_name.ilike.%${search}%`);
  if (orgFilter) query = query.eq("tenant_code", orgFilter.toUpperCase());
  if (statusFilter && ["active", "disabled", "deleted"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }
  if (userTypeFilter && ["personal", "organization"].includes(userTypeFilter)) {
    query = query.eq("user_type", userTypeFilter);
  }
  if (roleFilter && ["super_admin", "system_admin", "org_admin", "user"].includes(roleFilter)) {
    query = query.eq("role", roleFilter);
  }
  if (deptFilter) query = query.eq("dept_id", deptFilter);

  // 先取全部符合过滤的记录，在内存中按 状态+角色+时间 排序后手动分页
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
    // 1. 已注销沉底
    const aDel = a.status === "deleted" ? 1 : 0;
    const bDel = b.status === "deleted" ? 1 : 0;
    if (aDel !== bDel) return aDel - bDel;
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
