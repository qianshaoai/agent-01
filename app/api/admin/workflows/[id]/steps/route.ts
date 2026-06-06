import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessPayload } from "@/lib/session";
import { isCustomAdminPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
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

/** 给步骤路由用：custom admin 持有的最高 update key */
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

/** 取目标 workflow 的 scopes（custom admin step 写校验用） */
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

// 5.16up · R5 收口（小B 验收）：org_admin 归属校验 —— 与 workflows/[id] 的 PATCH/DELETE
// 的 ensureOrgAdminCanTouch 同口径。归属判定：该工作流的 resource_permissions 里有
// scope=本组织 / 本组织部门 / 本组织小组。非 org_admin 直接放行。
// （沿用本仓库既有写法：org_admin 校验工具按 route 文件各自内联，不跨文件共享）
async function ensureOrgAdminCanTouch(
  admin: { role: string; tenantCode?: string | null },
  workflowId: string
): Promise<Response | null> {
  if (admin.role !== "org_admin") return null;
  if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
  const tenantCode = admin.tenantCode;

  const [{ data: depts }, { data: teams }] = await Promise.all([
    db.from("departments").select("id").eq("tenant_code", tenantCode),
    db.from("teams").select("id").eq("tenant_code", tenantCode),
  ]);
  const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
  const teamIds = (teams ?? []).map((t: { id: string }) => t.id);

  const orFilters: string[] = [`and(scope_type.eq.org,scope_id.eq.${tenantCode})`];
  if (deptIds.length > 0) orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
  if (teamIds.length > 0) orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);

  const { data: hits } = await db
    .from("resource_permissions")
    .select("resource_id")
    .eq("resource_type", "workflow")
    .eq("resource_id", workflowId)
    .or(orFilters.join(","))
    .limit(1);

  if (!hits || hits.length === 0) {
    return apiError("无权操作该工作流", "FORBIDDEN");
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 6.4up · 双通道认证
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  if (!isCustomAdminPayload(access) && access.firstLogin === true) {
    return apiError("首次登录需先修改初始密码", "FORBIDDEN");
  }
  const { id: workflowId } = await params;

  // 6.4up · custom admin：校验对父 workflow 是否有 update 权限
  let admin: { adminId: string; username: string; role: string; tenantCode?: string | null };
  if (isCustomAdminPayload(access)) {
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
    // 5.11up · builtin：上下级权限校验
    const { data: wf } = await db
      .from("workflows")
      .select("created_by_role")
      .eq("id", workflowId)
      .single();
    if (!wf) return apiError("工作流不存在", "NOT_FOUND");
    const creatorRole = (wf.created_by_role ?? null) as AdminRole | null;
    const actorRole = (access.role ?? "super_admin") as AdminRole;
    if (!canActOnRole(actorRole, creatorRole)) {
      return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
    }
    // org_admin 归属校验
    const orgGuard = await ensureOrgAdminCanTouch(access, workflowId);
    if (orgGuard) return orgGuard;
    // Phase D D-3 · v2 第二闸（builtin；step 写视为 workflow update）
    if (isResourceEnforced("workflow") && access.role !== "super_admin") {
      const actorV2 = await buildPermissionActor(access);
      const e = await requireAccess(actorV2, "workflow", "update", { id: workflowId });
      if (e) return e;
    }
    admin = {
      adminId: access.adminId,
      username: access.username,
      role: access.role,
      tenantCode: access.tenantCode,
    };
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

// 5.16up · R5 工作流步骤拖拽改顺序：一次提交完整有序 step id 数组，原子重排
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 6.4up · 双通道认证
  const access = await getAdminAccessPayload();
  if (!access) return apiError("未登录或权限已变更", "UNAUTHORIZED");
  if (!isCustomAdminPayload(access) && access.firstLogin === true) {
    return apiError("首次登录需先修改初始密码", "FORBIDDEN");
  }
  const { id: workflowId } = await params;

  const { data: wf } = await db
    .from("workflows")
    .select("name, created_by_role")
    .eq("id", workflowId)
    .single();
  if (!wf) return apiError("工作流不存在", "NOT_FOUND");

  // 6.4up · custom admin 路径
  let admin: { adminId: string; username: string; role: string; tenantCode?: string | null };
  if (isCustomAdminPayload(access)) {
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
    // 5.11up builtin · 上下级权限校验
    const creatorRole = (wf.created_by_role ?? null) as AdminRole | null;
    const actorRole = (access.role ?? "super_admin") as AdminRole;
    if (!canActOnRole(actorRole, creatorRole)) {
      return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
    }
    const orgGuard = await ensureOrgAdminCanTouch(access, workflowId);
    if (orgGuard) return orgGuard;
    // Phase D D-3 · v2 第二闸（builtin；step 重排视为 workflow update）
    if (isResourceEnforced("workflow") && access.role !== "super_admin") {
      const actorV2 = await buildPermissionActor(access);
      const e = await requireAccess(actorV2, "workflow", "update", { id: workflowId });
      if (e) return e;
    }
    admin = {
      adminId: access.adminId,
      username: access.username,
      role: access.role,
      tenantCode: access.tenantCode,
    };
  }

  const body = await req.json().catch(() => ({}));
  const stepIds: unknown = body?.stepIds;
  if (!Array.isArray(stepIds) || stepIds.length === 0 || stepIds.some((s) => typeof s !== "string")) {
    return apiError("stepIds 必须是非空的步骤 ID 数组", "VALIDATION_ERROR");
  }
  if (new Set(stepIds).size !== stepIds.length) {
    return apiError("stepIds 含重复项", "VALIDATION_ERROR");
  }

  // 原子重排 RPC：内部再校验「传入集合 === 该工作流当前步骤集合」，一次性 UPDATE
  const { data: ok, error } = await db.rpc("reorder_workflow_steps", {
    p_workflow_id: workflowId,
    p_step_ids: stepIds,
  });
  if (error) return dbError(error);
  if (ok === false) {
    return apiError("步骤集合与当前工作流不一致，请刷新后重试", "VALIDATION_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "update", resourceType: "workflow", resourceId: workflowId, resourceName: wf.name ?? "",
    detail: { reorder_steps: stepIds.length },
  });
  return NextResponse.json({ ok: true });
}
