import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data } = await db
    .from("user_agents")
    .select("id, name, description, agent_type, platform, api_url, external_url, model_params, api_key_enc, enabled, created_at")
    .eq("user_id", user.userId)
    .eq("enabled", true)
    .order("created_at", { ascending: false });

  const masked = (data ?? []).map(({ api_key_enc, ...rest }) => ({
    ...rest,
    has_api_key: !!api_key_enc,
  }));
  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { name, description, agentType, platform, apiUrl, apiKey, externalUrl, modelParams } = body;

  if (!name?.trim()) return NextResponse.json({ error: "请填写名称" }, { status: 400 });
  if (agentType === "external" && !externalUrl?.trim()) {
    return NextResponse.json({ error: "外链型必须填写跳转 URL" }, { status: 400 });
  }

  const { data, error } = await db.from("user_agents").insert({
    user_id: user.userId,
    name: name.trim(),
    description: description ?? "",
    agent_type: agentType ?? "chat",
    platform: platform ?? "openai",
    api_url: apiUrl ?? "",
    api_key_enc: apiKey ? encrypt(apiKey) : "",
    external_url: externalUrl ?? "",
    model_params: modelParams ?? {},
  }).select("id, name, description, agent_type, platform, api_url, external_url, model_params, enabled, created_at").single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
