import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

// 5.7up · 仅 super_admin 可配置租户的 OpenAI key（GPT 接入阶段一）
// system_admin / org_admin 一律 403——OpenAI key 等同钱包，权限边界要锁死

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可配置 OpenAI Key", "FORBIDDEN");
  }

  const { id } = await params;
  const { apiKey } = await req.json();
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return apiError("API Key 不能为空", "VALIDATION_ERROR");
  }
  // OpenAI key 当前规范：sk- 开头 + 一串字符；做最低限度合法性检查，不做强校验
  // （allow openrouter / azure 兼容形态：sk-or-... / sk-... 各种）
  if (!/^sk-/.test(apiKey.trim())) {
    return apiError("API Key 格式不合法（应以 sk- 开头）", "VALIDATION_ERROR");
  }

  const enc = encrypt(apiKey.trim());
  const { error } = await db
    .from("tenants")
    .update({
      openai_key_enc: enc,
      openai_key_set_at: new Date().toISOString(),
      openai_key_set_by: admin.adminId,
    })
    .eq("id", id);

  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可清空 OpenAI Key", "FORBIDDEN");
  }

  const { id } = await params;
  const { error } = await db
    .from("tenants")
    .update({
      openai_key_enc: "",
      openai_key_set_at: null,
      openai_key_set_by: null,
    })
    .eq("id", id);

  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}

// GET：查询当前 key 的元信息（不返回明文 / 不返回密文，只回前缀掩码 + 配置时间）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") {
    return apiError("仅超级管理员可查看", "FORBIDDEN");
  }

  const { id } = await params;
  const { data, error } = await db
    .from("tenants")
    .select("openai_key_enc, openai_key_set_at, openai_key_set_by")
    .eq("id", id)
    .single();

  if (error) return dbError(error);
  const isSet = !!(data?.openai_key_enc && data.openai_key_enc.length > 0);
  return NextResponse.json({
    isSet,
    setAt: data?.openai_key_set_at ?? null,
    setBy: data?.openai_key_set_by ?? null,
  });
}
