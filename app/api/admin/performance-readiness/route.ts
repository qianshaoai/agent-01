import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { requireAdminActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await requireAdminActor();
  if (context instanceof Response) return context;
  if (!["super_admin", "system_admin"].includes(context.role)) {
    return apiError("无权读取性能验收状态", "FORBIDDEN");
  }

  const memory = process.memoryUsage();
  return NextResponse.json({
    flags: {
      dashboardSummaryV2:
        process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_SUMMARY_V2 === "true",
      analyticsSqlAgg: process.env.ADMIN_ANALYTICS_SQL_AGG === "true",
      agentCenterV2: process.env.ADMIN_AGENT_CENTER_V2 === "true",
    },
    node: {
      pid: process.pid,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    generatedAt: new Date().toISOString(),
  });
}

