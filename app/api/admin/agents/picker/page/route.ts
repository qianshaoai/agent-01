import { apiError, dbError } from "@/lib/api-error";
import {
  loadReadableAgentBindingSummaries,
  type AgentBindingSummary,
} from "@/lib/agent-binding-access";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permission-actor";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
const FALLBACK_SCAN_CHUNK = 500;
const FALLBACK_AUTH_CHUNK = 200;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeQuery(value: string | null) {
  return (value ?? "").trim().slice(0, 100);
}

async function getReadCapabilities(
  ctx: Exclude<Awaited<ReturnType<typeof requireAdminActor>>, Response>,
) {
  const isSuper = ctx.role === "super_admin";
  const orgScope = ctx.tenantCode
    ? [{ scope_type: "org" as const, scope_id: ctx.tenantCode }]
    : [];
  const [canReadAll, canReadOrg] = await Promise.all([
    isSuper ? true : hasPermission(ctx.actor, "agent.read.all"),
    isSuper || !ctx.tenantCode
      ? false
      : hasPermission(ctx.actor, "agent.read.org", orgScope),
  ]);
  return { canReadAll, canReadOrg };
}

async function fallbackPage(
  ctx: Exclude<Awaited<ReturnType<typeof requireAdminActor>>, Response>,
  q: string,
  page: number,
  pageSize: number,
) {
  const allIds: string[] = [];
  for (let start = 0; ; start += FALLBACK_SCAN_CHUNK) {
    const { data, error } = await db
      .from("agents")
      .select("id")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + FALLBACK_SCAN_CHUNK - 1);
    if (error) return dbError(error, "读取智能体候选失败");
    const batch = (data ?? []) as { id: string }[];
    allIds.push(...batch.map((row) => row.id));
    if (batch.length < FALLBACK_SCAN_CHUNK) break;
  }

  const readable: AgentBindingSummary[] = [];
  for (let start = 0; start < allIds.length; start += FALLBACK_AUTH_CHUNK) {
    const summaries = await loadReadableAgentBindingSummaries(
      ctx.actor,
      allIds.slice(start, start + FALLBACK_AUTH_CHUNK),
    );
    if (summaries instanceof Response) return summaries;
    readable.push(...summaries.values());
  }

  const needle = q.toLocaleLowerCase();
  const filtered = readable
    .filter((item) => {
      if (!needle) return true;
      return [item.name, item.agent_code, item.platform]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    })
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "zh-CN");
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
  const start = (page - 1) * pageSize;
  return NextResponse.json({
    contractVersion: 2,
    data: filtered.slice(start, start + pageSize),
    pagination: { page, pageSize, total: filtered.length },
  });
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const q = sanitizeQuery(req.nextUrl.searchParams.get("q"));
  const page = parsePositiveInt(req.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    parsePositiveInt(
      req.nextUrl.searchParams.get("pageSize"),
      PAGE_SIZE_DEFAULT,
    ),
  );
  const { canReadAll, canReadOrg } = await getReadCapabilities(ctx);
  if (!canReadAll && !canReadOrg) {
    return apiError("权限不足", "FORBIDDEN");
  }

  if (process.env.ADMIN_AGENT_PICKER_V2 !== "true") {
    return fallbackPage(ctx, q, page, pageSize);
  }

  const { data, error } = await db.rpc("admin_agent_picker_page", {
    p_tenant_code: ctx.tenantCode,
    p_can_read_all: canReadAll,
    p_can_read_org: canReadOrg,
    p_q: q || null,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) {
    console.error("[admin agent picker rpc]", error.code, error.message);
    return apiError("读取智能体候选失败", "INTERNAL_ERROR");
  }
  return NextResponse.json(
    data ?? {
      contractVersion: 2,
      data: [],
      pagination: { page, pageSize, total: 0 },
    },
  );
}
