import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET() {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { data, error } = await db
    .from("user_groups")
    .select("id, name, description, tenant_code, created_at, user_group_members(count)")
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) return dbError(error);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (data ?? []).map((g: any) => ({
    ...g,
    member_count: g.user_group_members?.[0]?.count ?? 0,
    user_group_members: undefined,
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { name, description, tenantCode } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "分组名称不能为空" }, { status: 400 });

  const { data, error } = await db
    .from("user_groups")
    .insert({ name: name.trim(), description: description?.trim() ?? "", tenant_code: tenantCode || null })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
