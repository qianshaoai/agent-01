/**
 * 6.4up v2 Phase B B.4 · 权限审计列表（Tab 4 用）
 *
 * 从 audit_logs 拉 resource_type IN ('builtin_role_permission','admin_override','custom_role') 的行。
 *
 * 权限：仅 super_admin（C1 约束；不复用 audit-logs route 的 org_admin 可见策略）
 *
 * 支持 query：
 *   resourceType=builtin_role_permission|admin_override|custom_role  （单选）
 *   adminId=...
 *   dateFrom=YYYY-MM-DD
 *   dateTo=YYYY-MM-DD
 *   page / pageSize 沿用通用分页
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, parsePagination, paginatedResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["builtin_role_permission", "admin_override", "custom_role"] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

function parseResourceType(v: string | null): AllowedType | null {
  if (!v) return null;
  if ((ALLOWED_TYPES as readonly string[]).includes(v)) return v as AllowedType;
  return null;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可访问", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 50);
  const sp = req.nextUrl.searchParams;
  const resourceType = parseResourceType(sp.get("resourceType"));
  const adminIdFilter = sp.get("adminId");
  const dateFrom = sp.get("dateFrom");
  const dateTo = sp.get("dateTo");

  let query = db
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 单类过滤 / 全三类
  if (resourceType) {
    query = query.eq("resource_type", resourceType);
  } else {
    query = query.in("resource_type", [...ALLOWED_TYPES]);
  }

  if (adminIdFilter) query = query.eq("admin_id", adminIdFilter);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59Z");

  query = query.range(start, start + pageSize - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}
