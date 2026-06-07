import { apiError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { isWorkflowConfigAdmin, type AdminRole } from "@/lib/admin-permissions";
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { hasPermission, type PermissionActor, type ResourceScope } from "@/lib/permission-actor";
import type { PermissionKey } from "@/lib/permission-keys";
import type { AdminActorContext } from "@/lib/session";

export type WorkflowScopeType = "org" | "dept" | "team";

export type WorkflowActionScope =
  | { all: true; org: null; dept: null; team: null }
  | { all: false; org: string; dept: null; team: null }
  | { all: false; org: null; dept: string; team: null }
  | { all: false; org: null; dept: null; team: string };

type WorkflowAction = "read" | "update" | "duplicate";

function legacyWorkflowConfigGuard(ctx: AdminActorContext): Response | null | undefined {
  if (ctx.isCustomAdmin || isResourceEnforced("workflow")) return undefined;
  if (isWorkflowConfigAdmin(ctx.role as AdminRole)) return null;
  return apiError("无权访问工作流配置", "FORBIDDEN");
}

function rankScope(scope: WorkflowActionScope | null): number {
  if (!scope) return 0;
  if (scope.all) return 4;
  if (scope.org) return 3;
  if (scope.dept) return 2;
  return 1;
}

function workflowPermissionKey(action: WorkflowAction, suffix: "all" | "org" | "dept" | "team"): PermissionKey {
  return `workflow.${action}.${suffix}` as PermissionKey;
}

export function scopeRow(scopeType: WorkflowScopeType, scopeId: string): { id: string; scopes: ResourceScope[] } {
  return {
    id: `scope:${scopeType}:${scopeId}`,
    scopes: [{ scope_type: scopeType, scope_id: scopeId }],
  };
}

export async function getWorkflowActionScope(
  actor: PermissionActor,
  action: WorkflowAction,
): Promise<WorkflowActionScope | null> {
  if (await hasPermission(actor, workflowPermissionKey(action, "all"))) {
    return { all: true, org: null, dept: null, team: null };
  }
  if (
    actor.tenantCode &&
    (await hasPermission(actor, workflowPermissionKey(action, "org"), [
      { scope_type: "org", scope_id: actor.tenantCode },
    ]))
  ) {
    return { all: false, org: actor.tenantCode, dept: null, team: null };
  }
  if (
    actor.deptId &&
    (await hasPermission(actor, workflowPermissionKey(action, "dept"), [
      { scope_type: "dept", scope_id: actor.deptId },
    ]))
  ) {
    return { all: false, org: null, dept: actor.deptId, team: null };
  }
  if (
    actor.teamId &&
    (await hasPermission(actor, workflowPermissionKey(action, "team"), [
      { scope_type: "team", scope_id: actor.teamId },
    ]))
  ) {
    return { all: false, org: null, dept: null, team: actor.teamId };
  }
  return null;
}

export async function getWorkflowConfigScope(actor: PermissionActor): Promise<WorkflowActionScope | null> {
  const readScope = await getWorkflowActionScope(actor, "read");
  const updateScope = await getWorkflowActionScope(actor, "update");
  return rankScope(readScope) >= rankScope(updateScope) ? readScope : updateScope;
}

export async function requireWorkflowAction(
  ctx: AdminActorContext,
  action: WorkflowAction,
): Promise<Response | null> {
  const legacy = legacyWorkflowConfigGuard(ctx);
  if (legacy !== undefined) return legacy;
  const scope = await getWorkflowActionScope(ctx.actor, action);
  if (!scope) return apiError("权限不足", "FORBIDDEN");
  return null;
}

export async function requireWorkflowConfigAccess(ctx: AdminActorContext): Promise<Response | null> {
  const legacy = legacyWorkflowConfigGuard(ctx);
  if (legacy !== undefined) return legacy;
  const scope = await getWorkflowConfigScope(ctx.actor);
  if (!scope) return apiError("无权访问工作流配置", "FORBIDDEN");
  return null;
}

export async function requireWorkflowScopeAccess(
  ctx: AdminActorContext,
  action: "read" | "update",
  scopeType: WorkflowScopeType,
  scopeId: string,
): Promise<Response | null> {
  const legacy = legacyWorkflowConfigGuard(ctx);
  if (legacy !== undefined) return legacy;
  return requireAccess(ctx.actor, "workflow", action, {
    row: scopeRow(scopeType, scopeId),
  });
}

export async function visibleWorkflowIdsForScope(scope: WorkflowActionScope): Promise<string[] | null> {
  if (scope.all) return null;

  const orFilters: string[] = [];
  if (scope.org) {
    const [{ data: depts }, { data: teams }] = await Promise.all([
      db.from("departments").select("id").eq("tenant_code", scope.org),
      db.from("teams").select("id").eq("tenant_code", scope.org),
    ]);
    const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
    const teamIds = (teams ?? []).map((t: { id: string }) => t.id);
    orFilters.push(`and(scope_type.eq.org,scope_id.eq.${scope.org})`);
    if (deptIds.length > 0) orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
    if (teamIds.length > 0) orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);
  } else if (scope.dept) {
    const { data: teams } = await db.from("teams").select("id").eq("dept_id", scope.dept);
    const teamIds = (teams ?? []).map((t: { id: string }) => t.id);
    orFilters.push(`and(scope_type.eq.dept,scope_id.eq.${scope.dept})`);
    if (teamIds.length > 0) orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);
  } else if (scope.team) {
    orFilters.push(`and(scope_type.eq.team,scope_id.eq.${scope.team})`);
  }

  if (orFilters.length === 0) return [];
  const { data } = await db
    .from("resource_permissions")
    .select("resource_id")
    .eq("resource_type", "workflow")
    .or(orFilters.join(","));
  return Array.from(new Set((data ?? []).map((r: { resource_id: string }) => r.resource_id)));
}
