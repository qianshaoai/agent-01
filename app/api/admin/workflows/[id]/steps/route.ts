import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";

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
  // org_admin 归属校验：与 PUT / workflows/[id] 的写操作边界保持一致
  const orgGuard = await ensureOrgAdminCanTouch(admin, workflowId);
  if (orgGuard) return orgGuard;

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
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id: workflowId } = await params;

  // 权限校验：与 POST 同口径（基于 created_by_role，沿用上下级权限）
  const { data: wf } = await db
    .from("workflows")
    .select("name, created_by_role")
    .eq("id", workflowId)
    .single();
  if (!wf) return apiError("工作流不存在", "NOT_FOUND");
  const creatorRole = (wf.created_by_role ?? null) as AdminRole | null;
  const actorRole = (admin.role ?? "super_admin") as AdminRole;
  if (!canActOnRole(actorRole, creatorRole)) {
    return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
  }
  // org_admin 归属校验：防越权重排别组织工作流的步骤（小B 验收收口）
  const orgGuard = await ensureOrgAdminCanTouch(admin, workflowId);
  if (orgGuard) return orgGuard;

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
