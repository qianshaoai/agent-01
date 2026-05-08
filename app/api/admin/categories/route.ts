import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function GET(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { page, pageSize, start } = parsePagination(req, 100);
  const { data, count } = await db
    .from("categories")
    .select("id, name, sort_order, icon_url", { count: "exact" })
    .order("sort_order")
    .range(start, start + pageSize - 1);

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { name } = await req.json();
  if (!name?.trim()) return apiError("分类名称不能为空", "VALIDATION_ERROR");

  const { data: existing } = await db.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).single();
  const nextOrder = (existing?.sort_order ?? 0) + 1;

  const { data, error } = await db
    .from("categories")
    .insert({ name: name.trim(), sort_order: nextOrder })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: "create", resourceType: "category", resourceId: data.id, resourceName: data.name,
  });
  return NextResponse.json(data, { status: 201 });
}
