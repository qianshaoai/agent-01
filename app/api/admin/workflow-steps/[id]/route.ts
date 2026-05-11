import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";

// 5.11up · 通过 step.id 反查所属 workflow 的 created_by_role，做上下级权限校验
async function ensureCanTouchStep(
  admin: { role: string },
  stepId: string
): Promise<Response | null> {
  const { data: step } = await db
    .from("workflow_steps")
    .select("workflow_id, workflows ( created_by_role )")
    .eq("id", stepId)
    .single();
  if (!step) return apiError("步骤不存在", "NOT_FOUND");
  const wf = (step.workflows as unknown) as { created_by_role: string | null } | null;
  const creatorRole = (wf?.created_by_role ?? null) as AdminRole | null;
  const actorRole = (admin.role ?? "super_admin") as AdminRole;
  if (!canActOnRole(actorRole, creatorRole)) {
    return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;
  const guard = await ensureCanTouchStep(admin, id);
  if (guard) return guard;
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
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
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
  const guard = await ensureCanTouchStep(admin, id);
  if (guard) return guard;
  const { data: step } = await db.from("workflow_steps").select("title").eq("id", id).maybeSingle();
  // 5.11up · 删除前缓存 tenant 归属，避免删完反查为 null
  const resourceTenantCode = await resolveResourceTenantCode("workflow_step", id);
  const { error } = await db.from("workflow_steps").delete().eq("id", id);
  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode,
    action: "delete", resourceType: "workflow_step", resourceId: id, resourceName: step?.title,
  });
  return NextResponse.json({ ok: true });
}
