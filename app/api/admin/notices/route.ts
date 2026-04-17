import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  let query = db
    .from("notices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  // 组织管理员只能看自己组织的公告 + 全局公告
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return NextResponse.json([]);
    query = query.or(`tenant_code.is.null,tenant_code.eq.${admin.tenantCode}`);
  }

  const { data } = await query;
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { tenantCode, content } = await req.json();
  if (!content?.trim()) {
    return NextResponse.json({ error: "公告内容不能为空" }, { status: 400 });
  }

  // 组织管理员：强制只能发自己组织的公告，禁止全局公告
  let finalTenantCode = tenantCode?.trim().toUpperCase() || null;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return NextResponse.json({ error: "你没有关联组织" }, { status: 403 });
    finalTenantCode = admin.tenantCode;
  }

  const { data, error } = await db
    .from("notices")
    .insert({
      tenant_code: finalTenantCode,
      content: content.trim(),
      enabled: true,
    })
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data, { status: 201 });
}
