import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { data } = await db.from("tenant_categories").select("tenant_code").eq("category_id", id);
  return NextResponse.json({ tenant_codes: (data ?? []).map((r) => r.tenant_code) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // 企业分配
  if (body.tenantCodes !== undefined) {
    await db.from("tenant_categories").delete().eq("category_id", id);
    if (body.tenantCodes.length > 0) {
      await db.from("tenant_categories").insert(
        body.tenantCodes.map((code: string) => ({ tenant_code: code, category_id: id }))
      );
    }
    return NextResponse.json({ ok: true });
  }

  const { name } = body;
  if (!name?.trim()) return NextResponse.json({ error: "分类名称不能为空" }, { status: 400 });

  const { data, error } = await db
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
