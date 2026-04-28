import { NextRequest, NextResponse } from "next/server";
import { getPayloadFromRequest, requireTrialUser } from "@/lib/auth";
import { trialAgents } from "@/lib/trial-agents";

export async function GET(req: NextRequest) {
  const payload = await getPayloadFromRequest(req);
  const guard = requireTrialUser(payload);
  if (guard) return guard;

  if (trialAgents.length === 0) {
    return NextResponse.json(
      { error: "trial agents not configured", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }

  // 脱敏：仅返回前端展示需要的字段
  const data = trialAgents.map(({ id, name, description, avatar, category }) => ({
    id,
    name,
    description,
    avatar,
    category,
  }));

  return NextResponse.json({ data });
}
