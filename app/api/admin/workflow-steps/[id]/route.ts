import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.stepOrder !== undefined) updates.step_order = body.stepOrder;
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  const validExecTypes = ["agent", "manual", "review", "external"];
  if (body.execType !== undefined) updates.exec_type = validExecTypes.includes(body.execType) ? body.execType : "agent";
  if (body.agentId !== undefined) updates.agent_id = updates.exec_type === "agent" ? (body.agentId || null) : null;
  if (body.buttonText !== undefined) updates.button_text = body.buttonText;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const { data, error } = await db
    .from("workflow_steps")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  const stepAction = body.enabled === true ? "enable" : body.enabled === false ? "disable" : "update";
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: stepAction, resourceType: "workflow_step", resourceId: id, resourceName: data.title,
  });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const { data: step } = await db.from("workflow_steps").select("title").eq("id", id).maybeSingle();
  const { error } = await db.from("workflow_steps").delete().eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role,
    action: "delete", resourceType: "workflow_step", resourceId: id, resourceName: step?.title,
  });
  return NextResponse.json({ ok: true });
}
