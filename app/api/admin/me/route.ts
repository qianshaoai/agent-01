import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  return NextResponse.json({
    adminId: admin.adminId,
    username: admin.username,
    role: admin.role ?? "super_admin",
    tenantCode: admin.tenantCode ?? null,
  });
}
