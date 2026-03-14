import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function getOwnedAgent(agentId: string, phone: string, tenantCode: string) {
  const { data: dbUser } = await db
    .from("users").select("id").eq("phone", phone).eq("tenant_code", tenantCode).single();
  if (!dbUser) return null;

  const { data } = await db
    .from("user_agents").select("*").eq("id", agentId).eq("user_id", dbUser.id).single();
  return data ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const agent = await getOwnedAgent(id, user.phone, user.tenantCode);
  if (!agent) return NextResponse.json({ error: "不存在或无权访问" }, { status: 404 });

  // 不返回原始 key
  const { api_key_enc, ...rest } = agent;
  return NextResponse.json({ ...rest, has_api_key: !!api_key_enc });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const agent = await getOwnedAgent(id, user.phone, user.tenantCode);
  if (!agent) return NextResponse.json({ error: "不存在或无权访问" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.platform !== undefined) updates.platform = body.platform;
  if (body.apiUrl !== undefined) updates.api_url = body.apiUrl;
  if (body.apiKey) updates.api_key_enc = body.apiKey;
  if (body.externalUrl !== undefined) updates.external_url = body.externalUrl;

  const { error } = await db.from("user_agents").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const agent = await getOwnedAgent(id, user.phone, user.tenantCode);
  if (!agent) return NextResponse.json({ error: "不存在或无权访问" }, { status: 404 });

  await db.from("user_agents").update({ enabled: false }).eq("id", id);
  return NextResponse.json({ ok: true });
}
