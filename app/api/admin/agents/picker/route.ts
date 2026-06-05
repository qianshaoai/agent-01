// 6.5up R1-1 · 工作流"引用智能体" picker 专用接口
//
// 与 /api/admin/agents 的关系：
//   - 列表管理页用 /api/admin/agents（含 pagination、permissions、workflows 反查、
//     api_key_masked、provider、categories 完整字段）
//   - picker 用本接口：极简字段，全量返回（hard cap 2000），用于工作流编辑步骤
//     里"绑定智能体"的下拉选择
//
// 为什么独立接口而不复用 ?mode=picker：
//   - 路径独立，演进到方案 C（服务端搜索 ?q=foo）时新增 query 参数语义清晰
//   - 不与列表接口的 RBAC / pagination 逻辑耦合，单接口职责单一
//
// Hard cap：limit(2000) + 同时 count(*) 拿真实总数；capped=true 时前端 popover
//   头部提示"超出部分需升级服务端搜索后才能查找"

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { dbError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const PICKER_HARD_CAP = 2000;

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 用 head: true 只取 count，不拉行数据；data 用单独 limit(2000) 查询拿前 2000 条
  const [countRes, dataRes] = await Promise.all([
    db.from("agents").select("id", { count: "exact", head: true }),
    db
      .from("agents")
      .select(
        "id, agent_code, name, description, platform, agent_type, external_url, published_from_draft_id",
      )
      .order("name", { ascending: true })
      .limit(PICKER_HARD_CAP),
  ]);

  if (countRes.error) return dbError(countRes.error);
  if (dataRes.error) return dbError(dataRes.error);

  const totalCount = countRes.count ?? 0;
  const data = dataRes.data ?? [];

  return NextResponse.json({
    data,
    totalCount,
    capped: totalCount > PICKER_HARD_CAP,
  });
}
