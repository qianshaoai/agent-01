import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data } = await db
    .from("agents")
    .select("id, agent_code, name, description, platform, enabled, category_id, categories(name), api_endpoint, api_key_enc")
    .order("created_at", { ascending: false });

  // 脱敏 API Key（只显示末4位）
  const masked = (data ?? []).map((a) => ({
    ...a,
    api_key_masked: a.api_key_enc
      ? "••••••••••••" + a.api_key_enc.slice(-4)
      : "",
    api_key_enc: undefined, // 不返回原始 key
  }));

  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { agentCode, name, description, categoryId, platform, apiEndpoint, apiKey, modelParams } =
    await req.json();

  if (!agentCode || !name || !platform) {
    return NextResponse.json({ error: "请填写编号、名称和平台" }, { status: 400 });
  }

  const { data, error } = await db
    .from("agents")
    .insert({
      agent_code: agentCode.toUpperCase(),
      name,
      description: description ?? "",
      category_id: categoryId || null,
      platform,
      api_endpoint: apiEndpoint ?? "",
      api_key_enc: apiKey ?? "",       // 生产环境建议加密存储
      model_params: modelParams ?? {},
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "智能体编号已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
