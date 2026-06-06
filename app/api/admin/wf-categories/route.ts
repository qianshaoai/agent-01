import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminAccessPayload } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { isTagAdmin } from "@/lib/admin-permissions";

export async function GET(req: NextRequest) {
  // 6.4up 验收修复 · 工作流标签是「工作流管理」页分区渲染的引用数据，custom admin 也需读
  //   （否则带标签的工作流匹配不到已加载标签 → 既不进标签区也不算"未设置标签" → 被前端丢弃）。
  //   仅放开 GET 只读；标签增删改（下方 POST/PATCH/DELETE）仍走 requireAdmin + isTagAdmin。
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");

  const { page, pageSize, start } = parsePagination(req, 100);
  const { data, count } = await db
    .from("wf_categories")
    .select("id, name, sort_order, icon_url", { count: "exact" })
    .order("sort_order")
    .range(start, start + pageSize - 1);

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (!isTagAdmin(admin.role)) return apiError("无权管理标签", "FORBIDDEN");

  const { name } = await req.json();
  if (!name?.trim()) return apiError("分类名称不能为空", "VALIDATION_ERROR");

  const { data: existing } = await db
    .from("wf_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = (existing?.sort_order ?? 0) + 1;

  const { data, error } = await db
    .from("wf_categories")
    .insert({ name: name.trim(), sort_order: nextOrder })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "wf_category", resourceId: data.id, resourceName: data.name,
  });
  return NextResponse.json(data, { status: 201 });
}
