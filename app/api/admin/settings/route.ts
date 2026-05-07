import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { data } = await db.from("system_settings").select("key, value");

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.key] = row.value;
  }

  return NextResponse.json({
    logo_url: map.logo_url ?? "",
    platform_name: map.platform_name ?? "前哨AI人机协同工作舱",
    help_doc_url: map.help_doc_url ?? "",
    contact_qr_url: map.contact_qr_url ?? "",
    contact_qr_text: map.contact_qr_text ?? "扫码添加微信，获取专属服务",
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.7up · 品牌设置仅 super_admin 可改
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "无权修改品牌设置" }, { status: 403 });
  }

  const body = await req.json();
  const now = new Date().toISOString();

  if (typeof body.platform_name === "string") {
    await db.from("system_settings").upsert(
      { key: "platform_name", value: body.platform_name, updated_at: now },
      { onConflict: "key" }
    );
  }

  if (typeof body.logo_url === "string") {
    await db.from("system_settings").upsert(
      { key: "logo_url", value: body.logo_url, updated_at: now },
      { onConflict: "key" }
    );
  }

  if (typeof body.help_doc_url === "string") {
    await db.from("system_settings").upsert(
      { key: "help_doc_url", value: body.help_doc_url, updated_at: now },
      { onConflict: "key" }
    );
  }

  if (typeof body.contact_qr_text === "string") {
    await db.from("system_settings").upsert(
      { key: "contact_qr_text", value: body.contact_qr_text, updated_at: now },
      { onConflict: "key" }
    );
  }

  return NextResponse.json({ ok: true });
}
