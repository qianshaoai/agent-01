import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data } = await db
    .from("categories")
    .select("id, name, sort_order, icon_url")
    .order("sort_order");

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "分类名称不能为空" }, { status: 400 });

  const { data: existing } = await db.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).single();
  const nextOrder = (existing?.sort_order ?? 0) + 1;

  const { data, error } = await db
    .from("categories")
    .insert({ name: name.trim(), sort_order: nextOrder })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
