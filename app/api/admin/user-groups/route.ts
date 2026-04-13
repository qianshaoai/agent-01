import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data, error } = await db
    .from("user_groups")
    .select("id, name, description, tenant_code, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 附加成员数量
  const groups = data ?? [];
  const counts = await Promise.all(
    groups.map((g) =>
      db.from("user_group_members").select("*", { count: "exact", head: true }).eq("group_id", g.id)
    )
  );

  const result = groups.map((g, i) => ({ ...g, member_count: counts[i].count ?? 0 }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { name, description, tenantCode } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "分组名称不能为空" }, { status: 400 });

  const { data, error } = await db
    .from("user_groups")
    .insert({ name: name.trim(), description: description?.trim() ?? "", tenant_code: tenantCode || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
