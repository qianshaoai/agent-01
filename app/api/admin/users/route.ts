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

  let query = db
    .from("users")
    .select(
      "id, phone, nickname, username, real_name, tenant_code, user_type, role, status, first_login, created_at, last_login_at, dept_id, team_id, departments(name), teams(name)",
      { count: "exact" }
    );

  if (search) query = query.ilike("phone", `%${search}%`);
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

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ users: data ?? [], total: count ?? 0, page, pageSize });
}
