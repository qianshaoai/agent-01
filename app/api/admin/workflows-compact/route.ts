/**
 * 6.3up R1.3 Finding 1 · 工作流配置页 AddWorkflowModal 专用轻量端点
 *
 * 起因：弹窗本来调 `/api/admin/workflows?pageSize=200`，但 PAGINATION.MAX_PAGE_SIZE=100
 * 会被 parsePagination 静默截断到 100，工作流总量 > 100 时其余无法被分配到层级（dead UI）。
 *
 * 本端点：
 * - 仅 isWorkflowConfigAdmin 可访问（与配置页同口径）
 * - 返回最小字段集 {id, name, description, enabled, visible_to} —— 弹窗渲染够用
 * - 不分页 · 服务端硬上限 5000（远高于现实业务规模，防止失控）
 * - 不带 step / category / permissions 副表，response 体积比主列表小一个数量级
 */

import { dbError, apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { isWorkflowConfigAdmin } from "@/lib/admin-permissions";

const HARD_CAP = 5000;

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (!isWorkflowConfigAdmin(admin.role)) return apiError("无权访问工作流配置", "FORBIDDEN");

  const { data, error } = await db
    .from("workflows")
    .select("id, name, description, enabled, visible_to")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(HARD_CAP);
  if (error) return dbError(error);

  return NextResponse.json({
    data: data ?? [],
    truncated: (data?.length ?? 0) >= HARD_CAP,
    hardCap: HARD_CAP,
  });
}
