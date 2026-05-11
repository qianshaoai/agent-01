import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id: workflowId } = await params;

  // 5.11up · 校验当前管理员是否有权修改该工作流（基于 created_by_role）
  const { data: wf } = await db
    .from("workflows")
    .select("created_by_role")
    .eq("id", workflowId)
    .single();
  if (!wf) return apiError("工作流不存在", "NOT_FOUND");
  const creatorRole = (wf.created_by_role ?? null) as AdminRole | null;
  const actorRole = (admin.role ?? "super_admin") as AdminRole;
  if (!canActOnRole(actorRole, creatorRole)) {
    return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
  }

  const { stepOrder, title, description, execType, agentId, buttonText, enabled } = await req.json();

  if (!title) return apiError("请填写步骤标题", "VALIDATION_ERROR");

  const validExecTypes = ["agent", "manual", "review", "external"];
  const safeExecType = validExecTypes.includes(execType) ? execType : "agent";

  const { data, error } = await db
    .from("workflow_steps")
    .insert({
      workflow_id: workflowId,
      step_order: stepOrder ?? 1,
      title,
      description: description ?? "",
      exec_type: safeExecType,
      agent_id: safeExecType === "agent" ? (agentId || null) : null,
      button_text: buttonText ?? "进入智能体",
      enabled: enabled ?? true,
    })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "workflow_step", resourceId: data.id, resourceName: data.title,
    detail: { workflow_id: workflowId },
  });
  return NextResponse.json(data, { status: 201 });
}
