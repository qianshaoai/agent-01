import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { getVisibleResourcesForUser } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getActiveAdmin();
  if (!admin) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const visibility = await getVisibleResourcesForUser(id);
  return NextResponse.json(visibility);
}
