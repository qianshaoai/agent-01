/**
 * 6.4up v2 Phase B B.1 · builtin admin 列表（Tab 1 用）
 *
 * 联合 admins 表（admin_table 源）+ users WHERE role IN (super,system,org)（user_admin 源），
 * 每行附 override 条数（不算 effective set，按 R5 列表层不做大计算）。
 *
 * 权限：仅 super_admin（C1 约束）
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, dbError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

type AdminRow = {
  id: string;
  source: "admin_table" | "user_admin";
  username: string;
  role: "super_admin" | "system_admin" | "org_admin";
  tenantCode: string | null;
  overrideCount: number;
};

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可访问", "FORBIDDEN");
  }

  // ── 拉两源 admin ────────────────────────────────────────────────
  const [adminsRes, usersRes, overridesRes] = await Promise.all([
    db.from("admins").select("id, username, role, tenant_code"),
    db
      .from("users")
      .select("id, username, phone, role, tenant_code, status")
      .in("role", ["super_admin", "system_admin", "org_admin"]),
    db.from("admin_permission_overrides").select("admin_id, admin_source"),
  ]);
  if (adminsRes.error) return dbError(adminsRes.error);
  if (usersRes.error) return dbError(usersRes.error);
  if (overridesRes.error) return dbError(overridesRes.error);

  // ── 按 (source, id) 算 override 条数 ────────────────────────────
  const overrideCountMap = new Map<string, number>();
  for (const o of (overridesRes.data ?? []) as { admin_id: string; admin_source: string }[]) {
    const k = `${o.admin_source}:${o.admin_id}`;
    overrideCountMap.set(k, (overrideCountMap.get(k) ?? 0) + 1);
  }

  const rows: AdminRow[] = [];
  type AdminTableRow = {
    id: string;
    username: string | null;
    role: "super_admin" | "system_admin" | "org_admin";
    tenant_code: string | null;
  };
  for (const a of (adminsRes.data ?? []) as AdminTableRow[]) {
    rows.push({
      id: a.id,
      source: "admin_table",
      username: a.username ?? "(无用户名)",
      role: a.role,
      tenantCode: a.tenant_code ?? null,
      overrideCount: overrideCountMap.get(`admin_table:${a.id}`) ?? 0,
    });
  }
  type UserRow = {
    id: string;
    username: string | null;
    phone: string | null;
    role: "super_admin" | "system_admin" | "org_admin";
    tenant_code: string | null;
    status: string;
  };
  for (const u of (usersRes.data ?? []) as UserRow[]) {
    // 仅 active 进入展示（disabled/deleted 隐藏，避免误改）
    if (u.status !== "active") continue;
    rows.push({
      id: u.id,
      source: "user_admin",
      username: u.username ?? u.phone ?? "(无用户名)",
      role: u.role,
      tenantCode: u.tenant_code ?? null,
      overrideCount: overrideCountMap.get(`user_admin:${u.id}`) ?? 0,
    });
  }

  // 按 role 优先级 + username 升序排
  const roleOrder: Record<string, number> = { super_admin: 0, system_admin: 1, org_admin: 2 };
  rows.sort((a, b) => {
    const r = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
    if (r !== 0) return r;
    return a.username.localeCompare(b.username, "zh-Hans-CN");
  });

  return NextResponse.json({ data: rows });
}
