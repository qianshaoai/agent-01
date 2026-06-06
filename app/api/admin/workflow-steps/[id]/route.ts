import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, getAdminAccessPayload } from "@/lib/session";
import { isCustomAdminPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";
import {
  buildPermissionActor,
  hasPermission,
  PermissionActor,
  ResourceScope,
} from "@/lib/permission-actor";
import { PermissionKey } from "@/lib/permission-keys";
// 6.4up v2 Phase D · D-3 · workflow step builtin 路径 enforce（env "workflow"；空时 no-op；custom 分支不走）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";

function pickStepUpdateKey(actor: PermissionActor): PermissionKey | null {
  const order: PermissionKey[] = [
    "workflow.update.all",
    "workflow.update.org",
    "workflow.update.dept",
    "workflow.update.team",
  ];
  for (const k of order) if (actor.permissions.has(k)) return k;
  return null;
}

async function getWorkflowScopesForStep(workflowId: string): Promise<ResourceScope[]> {
  const { data } = await db
    .from("resource_permissions")
    .select("scope_type, scope_id")
    .eq("resource_type", "workflow")
    .eq("resource_id", workflowId);
  type Row = { scope_type: string; scope_id: string | null };
  return (data ?? []).map((r) => ({
    scope_type: (r as Row).scope_type as ResourceScope["scope_type"],
    scope_id: (r as Row).scope_id,
  }));
}

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
  // 6.4up · 双通道认证
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  if (!isCustomAdminPayload(access) && access.firstLogin === true) {
    return apiError("首次登录需先修改初始密码", "FORBIDDEN");
  }
  const { id } = await params;

  let admin: { adminId: string; username: string; role: string; tenantCode?: string | null };

  if (isCustomAdminPayload(access)) {
    // 反查 step 所属 workflow + scopes
    const { data: step } = await db
      .from("workflow_steps")
      .select("workflow_id")
      .eq("id", id)
      .maybeSingle();
    if (!step) return apiError("步骤不存在", "NOT_FOUND");
    const workflowId = (step as { workflow_id: string }).workflow_id;
    const actor = await buildPermissionActor(access);
    const updateKey = pickStepUpdateKey(actor);
    if (!updateKey) return apiError("无修改工作流权限", "FORBIDDEN");
    const scopes = await getWorkflowScopesForStep(workflowId);
    if (scopes.length === 0) return apiError("工作流无 scope 归属，无法操作", "FORBIDDEN");
    const ok = await hasPermission(actor, updateKey, scopes);
    if (!ok) return apiError("目标工作流超出权限范围", "FORBIDDEN");
    admin = {
      adminId: actor.actorId,
      username: actor.username,
      role: "custom_admin",
      tenantCode: actor.tenantCode,
    };
  } else {
    const guard = await ensureCanTouchStep(access, id);
    if (guard) return guard;
    // Phase D D-3 · v2 第二闸（builtin；step 改视为 workflow update）
    if (isResourceEnforced("workflow") && access.role !== "super_admin") {
      const { data: st } = await db.from("workflow_steps").select("workflow_id").eq("id", id).maybeSingle();
      if (!st) return apiError("步骤不存在", "NOT_FOUND");
      const actorV2 = await buildPermissionActor(access);
      const e = await requireAccess(actorV2, "workflow", "update", {
        id: (st as { workflow_id: string }).workflow_id,
      });
      if (e) return e;
    }
    admin = {
      adminId: access.adminId,
      username: access.username,
      role: access.role,
      tenantCode: access.tenantCode,
    };
  }

  const body = await req.json();

  // 6.4up · custom admin 禁止启停步骤（方案 R1.2 不开放范围）
  if (admin.role === "custom_admin" && body.enabled !== undefined) {
    return apiError("custom 角色不能启停步骤", "FORBIDDEN");
  }

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
  // Phase D D-3 · v2 第二闸（builtin；step 删视为 workflow update）
  if (isResourceEnforced("workflow") && admin.role !== "super_admin") {
    const { data: st } = await db.from("workflow_steps").select("workflow_id").eq("id", id).maybeSingle();
    if (!st) return apiError("步骤不存在", "NOT_FOUND");
    const actorV2 = await buildPermissionActor(admin);
    const e = await requireAccess(actorV2, "workflow", "update", {
      id: (st as { workflow_id: string }).workflow_id,
    });
    if (e) return e;
  }
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
