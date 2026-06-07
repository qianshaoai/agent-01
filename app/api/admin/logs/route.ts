import { apiError, dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { PAGINATION } from "@/lib/config";
import { hasPermission } from "@/lib/permission-actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (ctx.role !== "super_admin") {
    const okOrg = ctx.tenantCode
      ? await hasPermission(ctx.actor, "audit.read.org", [
          { scope_type: "org", scope_id: ctx.tenantCode },
        ])
      : false;
    const okAll = await hasPermission(ctx.actor, "audit.read.all");
    if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const tenantCode = searchParams.get("tenantCode") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(PAGINATION.MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));

  let query = db
    .from("logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 非 all 权限只能看自己组织的日志
  if (ctx.role !== "super_admin" && !(await hasPermission(ctx.actor, "audit.read.all"))) {
    if (!ctx.tenantCode) return NextResponse.json({ data: [], pagination: { page, pageSize, total: 0 } });
    query = query.eq("tenant_code", ctx.tenantCode);
  } else if (tenantCode) {
    query = query.eq("tenant_code", tenantCode);
  }

  if (status) query = query.eq("status", status);
  if (search) {
    query = query.or(
      `user_phone.ilike.%${search}%,tenant_code.ilike.%${search}%,agent_name.ilike.%${search}%`
    );
  }

  const start = (page - 1) * pageSize;
  const { data, count, error } = await query.range(start, start + pageSize - 1);

  if (error) return dbError(error);
  return NextResponse.json({ data: data ?? [], pagination: { page, pageSize, total: count ?? 0 } });
}
