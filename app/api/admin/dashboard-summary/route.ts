import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permission-actor";
import {
  markRequestAuth,
  markRequestBusiness,
  withRequestLog,
} from "@/lib/request-logger";
import { requireAdminActor } from "@/lib/session";
import { tenantPublicOrOwnFilter } from "@/lib/scoped-access";

export const dynamic = "force-dynamic";

type SummaryPayload = {
  totalTenants: number | null;
  totalUsers: number | null;
  totalAgents: number | null;
  totalNotices: number | null;
  totalCalls: number | null;
  successCalls: number | null;
  successRate: number | null;
  topAgents: Array<{ id: string; name: string; calls: number }> | null;
  tenantUsage: Array<{ code: string; name: string; used: number; quota: number }> | null;
  generatedAt: string;
};

type CacheEntry = { expiresAt: number; value: SummaryPayload };
const summaryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

function permissionFingerprint(permissions: Set<string>): string {
  return Array.from(permissions).sort().join(",");
}

async function getDashboardSummary(req: import("next/server").NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  markRequestAuth(req, { source: ctx.source, role: ctx.role });
  if (ctx.isCustomAdmin) {
    return apiError("自定义管理员无权访问控制台摘要", "FORBIDDEN");
  }

  const cacheKey = [
    ctx.source,
    ctx.adminId,
    ctx.role,
    permissionFingerprint(ctx.actor.effectivePermissions),
    ctx.tenantCode ?? "",
    ctx.actor.deptId ?? "",
    ctx.actor.teamId ?? "",
  ].join("|");
  const cached = summaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    markRequestBusiness(req);
    return NextResponse.json(cached.value, {
      headers: { "X-Admin-Summary-Cache": "hit" },
    });
  }

  const isSuper = ctx.role === "super_admin";
  const orgScope = ctx.tenantCode
    ? [{ scope_type: "org" as const, scope_id: ctx.tenantCode }]
    : [];

  const [
    tenantAll,
    userAll,
    userOrg,
    agentAll,
    agentOrg,
    noticeAll,
    noticeOrg,
    auditAll,
    auditOrg,
  ] = await Promise.all([
    isSuper ? true : hasPermission(ctx.actor, "tenant.read.all"),
    isSuper ? true : hasPermission(ctx.actor, "user.read.all"),
    isSuper || !ctx.tenantCode
      ? false
      : hasPermission(ctx.actor, "user.read.org", orgScope),
    isSuper ? true : hasPermission(ctx.actor, "agent.read.all"),
    isSuper || !ctx.tenantCode
      ? false
      : hasPermission(ctx.actor, "agent.read.org", orgScope),
    isSuper ? true : hasPermission(ctx.actor, "notice.read.all"),
    isSuper || !ctx.tenantCode
      ? false
      : hasPermission(ctx.actor, "notice.read.org", orgScope),
    isSuper ? true : hasPermission(ctx.actor, "audit.read.all"),
    isSuper || !ctx.tenantCode
      ? false
      : hasPermission(ctx.actor, "audit.read.org", orgScope),
  ]);

  const tenantCountPromise = tenantAll
    ? (ctx.role === "org_admin" && ctx.tenantCode
        ? db
            .from("tenants")
            .select("code, name, quota, quota_used", { count: "exact" })
            .eq("code", ctx.tenantCode)
        : db
            .from("tenants")
            .select("code, name, quota, quota_used", { count: "exact" })
            .order("created_at", { ascending: false }))
    : Promise.resolve({ data: null, count: null, error: null });

  let userCountQuery = db
    .from("users")
    .select("*", { count: "exact", head: true })
    .neq("status", "deleted");
  if (!userAll && userOrg && ctx.tenantCode) {
    userCountQuery = userCountQuery.eq("tenant_code", ctx.tenantCode);
  }
  const userCountPromise = userAll || userOrg
    ? userCountQuery
    : Promise.resolve({ count: null, error: null });

  let noticeCountQuery = db
    .from("notices")
    .select("*", { count: "exact", head: true });
  if (!noticeAll && noticeOrg && ctx.tenantCode) {
    noticeCountQuery = noticeCountQuery.or(tenantPublicOrOwnFilter(ctx.tenantCode));
  }
  const noticeCountPromise = noticeAll || noticeOrg
    ? noticeCountQuery
    : Promise.resolve({ count: null, error: null });

  const agentCountPromise = agentAll || agentOrg
    ? db.rpc("admin_visible_agent_count", {
        p_allow_all: agentAll,
        p_tenant_code: agentAll ? null : ctx.tenantCode,
      })
    : Promise.resolve({ data: null, error: null });

  const auditTenant = auditAll ? null : ctx.tenantCode;
  const usagePromise = auditAll || auditOrg
    ? db.rpc("admin_usage_summary", {
        p_tenant_code: auditTenant,
        p_since: null,
      })
    : Promise.resolve({ data: null, error: null });

  const [tenantResult, userResult, noticeResult, agentResult, usageResult] =
    await Promise.all([
      tenantCountPromise,
      userCountPromise,
      noticeCountPromise,
      agentCountPromise,
      usagePromise,
    ]);

  const firstError =
    tenantResult.error ??
    userResult.error ??
    noticeResult.error;
  if (firstError) {
    console.error("[dashboard summary db]", firstError.code, firstError.message);
    return apiError("获取控制台摘要失败", "INTERNAL_ERROR");
  }
  if (agentResult.error) {
    console.error(
      "[dashboard summary agent metric unavailable]",
      agentResult.error.code,
      agentResult.error.message,
    );
  }
  if (usageResult.error) {
    console.error(
      "[dashboard summary usage metric unavailable]",
      usageResult.error.code,
      usageResult.error.message,
    );
  }

  const usage = (usageResult.data ?? null) as {
    totalCalls?: number;
    successCalls?: number;
    successRate?: number;
    topAgents?: SummaryPayload["topAgents"];
    tenantUsage?: SummaryPayload["tenantUsage"];
  } | null;
  const tenantUsage = ((tenantResult.data ?? []) as Array<{
    code: string;
    name: string;
    quota: number;
    quota_used: number;
  }>).map((tenant) => ({
    code: tenant.code,
    name: tenant.name,
    used: tenant.quota_used,
    quota: tenant.quota,
  }));

  const value: SummaryPayload = {
    totalTenants: tenantAll ? tenantResult.count ?? 0 : null,
    totalUsers: userAll || userOrg ? userResult.count ?? 0 : null,
    totalAgents:
      (agentAll || agentOrg) && !agentResult.error
        ? Number(agentResult.data ?? 0)
        : null,
    totalNotices: noticeAll || noticeOrg ? noticeResult.count ?? 0 : null,
    totalCalls: (auditAll || auditOrg) && !usageResult.error ? usage?.totalCalls ?? 0 : null,
    successCalls: (auditAll || auditOrg) && !usageResult.error ? usage?.successCalls ?? 0 : null,
    successRate: (auditAll || auditOrg) && !usageResult.error ? usage?.successRate ?? 100 : null,
    topAgents: (auditAll || auditOrg) && !usageResult.error ? usage?.topAgents ?? [] : null,
    tenantUsage: tenantAll ? tenantUsage : null,
    generatedAt: new Date().toISOString(),
  };

  summaryCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  if (summaryCache.size > 500) {
    for (const [key, entry] of summaryCache) {
      if (entry.expiresAt <= Date.now()) summaryCache.delete(key);
    }
  }

  markRequestBusiness(req);
  return NextResponse.json(value, {
    headers: { "X-Admin-Summary-Cache": "miss" },
  });
}

export const GET = withRequestLog(getDashboardSummary);
