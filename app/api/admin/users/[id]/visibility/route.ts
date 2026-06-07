import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access-facade";
import { getVisibleResourcesForUser } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const { data: target } = await db.from("users").select("id, tenant_code").eq("id", id).maybeSingle();
  if (!target) return apiError("用户不存在", "NOT_FOUND");
  const accessErr = await requireAccess(ctx.actor, "user", "read", {
    row: { id: target.id, tenant_code: target.tenant_code },
  });
  if (accessErr) return accessErr;
  const visibility = await getVisibleResourcesForUser(id);
  return NextResponse.json(visibility);
}
