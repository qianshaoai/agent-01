import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { getVisibleResourcesForUser } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return apiError("未登录", "UNAUTHORIZED");

  const { id } = await params;
  const visibility = await getVisibleResourcesForUser(id);
  return NextResponse.json(visibility);
}
