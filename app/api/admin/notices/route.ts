import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data } = await db
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { tenantCode, content } = await req.json();
  if (!content?.trim()) {
    return NextResponse.json({ error: "公告内容不能为空" }, { status: 400 });
  }

  const { data, error } = await db
    .from("notices")
    .insert({
      tenant_code: tenantCode?.trim().toUpperCase() || null,
      content: content.trim(),
      enabled: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
