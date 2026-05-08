import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { parsePagination, paginatedResponse, apiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 仅 super_admin / system_admin 可访问
  if (admin.role === "org_admin") {
    return apiError("无权查看变更审计记录", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 50);
  const sp = req.nextUrl.searchParams;
  const resourceType = sp.get("resourceType");   // agent | workflow
  const action       = sp.get("action");          // create | update | delete | enable | disable
  const adminId      = sp.get("adminId");
  const dateFrom     = sp.get("dateFrom");
  const dateTo       = sp.get("dateTo");

  let query = db
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (resourceType) query = query.eq("resource_type", resourceType);
  if (action)       query = query.eq("action", action);
  if (adminId)      query = query.eq("admin_id", adminId);
  if (dateFrom)     query = query.gte("created_at", dateFrom);
  if (dateTo)       query = query.lte("created_at", dateTo + "T23:59:59Z");

  query = query.range(start, start + pageSize - 1);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}
