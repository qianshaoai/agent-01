import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
// 6.4up v2 Phase C · audit 走 env-gated hasPermission（不走 facade，列表无 row）
import { hasPermission } from "@/lib/permission-actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  // 5.11up · 所有管理员（含 org_admin）可访问审计记录入口
  // org_admin 看到的内容按本组织过滤（见下方 OR 条件）

  if (ctx.role !== "super_admin") {
    const okOrg = ctx.tenantCode
      ? await hasPermission(ctx.actor, "audit.read.org", [
          { scope_type: "org", scope_id: ctx.tenantCode },
        ])
      : false;
    const okAll = await hasPermission(ctx.actor, "audit.read.all");
    if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
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

  // 5.11up · org_admin 只看本组织相关：admin_tenant_code = 本组织（自己发起的） OR
  // resource_tenant_code = 本组织（任何管理员动了本组织资源）
  if (ctx.role !== "super_admin" && !(await hasPermission(ctx.actor, "audit.read.all"))) {
    if (!ctx.tenantCode) return paginatedResponse([], 0, page, pageSize);
    query = query.or(`admin_tenant_code.eq.${ctx.tenantCode},resource_tenant_code.eq.${ctx.tenantCode}`);
  }

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
