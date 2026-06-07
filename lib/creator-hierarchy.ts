import { apiError } from "@/lib/api-error";
import {
  canActOnRole,
  noWritePermissionMessage,
  type AdminRole,
} from "@/lib/admin-permissions";
import type { PermissionActor, PermissionKey } from "@/lib/permission-actor";
import type { AdminActorContext } from "@/lib/session";

export type CreatorHierarchyResource = "agent" | "knowledge_base" | "workflow";

const CUSTOM_ALL_WRITE_KEYS: Record<CreatorHierarchyResource, readonly string[]> = {
  agent: [
    "agent.basic.update.all",
    "agent.enable.all",
    "agent.delete.all",
    "agent.reindex.all",
    "agent_draft.create.all",
    "agent_draft.update.all",
    "agent_draft.delete.all",
    "agent_draft.duplicate.all",
    "agent_draft.publish.all",
    "agent_draft.test.all",
  ],
  knowledge_base: [
    "kb.create.all",
    "kb.update.all",
    "kb.delete.all",
  ],
  workflow: [
    "workflow.create.all",
    "workflow.update.all",
    "workflow.enable.all",
    "workflow.duplicate.all",
    "workflow.delete.all",
  ],
};

function normalizeCreatorRole(role: unknown): AdminRole {
  if (role === "super_admin" || role === "system_admin" || role === "org_admin") {
    return role;
  }
  return "system_admin";
}

/**
 * custom admin 没有 builtin role。6.6up B 规则把它按当前资源相关写权限的最高 scope 折算：
 * 持有任一 .all 写权限 => system_admin；否则 team/dept/org 写权限都按 org_admin。
 */
export function actorHierarchyRole(
  actor: PermissionActor,
  resource: CreatorHierarchyResource,
): AdminRole {
  if (actor.builtinRole) return actor.builtinRole;
  const allWriteKeys = CUSTOM_ALL_WRITE_KEYS[resource];
  for (const key of allWriteKeys) {
    if (actor.permissions.has(key as PermissionKey)) return "system_admin";
  }
  return "org_admin";
}

export function canActorTouchCreator(
  actor: PermissionActor,
  resource: CreatorHierarchyResource,
  creatorRole: unknown,
): boolean {
  if (actor.builtinRole === "super_admin") return true;
  return canActOnRole(actorHierarchyRole(actor, resource), normalizeCreatorRole(creatorRole));
}

export function requireActorCreatorHierarchy(
  actor: PermissionActor,
  resource: CreatorHierarchyResource,
  creatorRole: unknown,
): Response | null {
  if (canActorTouchCreator(actor, resource, creatorRole)) return null;
  return apiError(noWritePermissionMessage(normalizeCreatorRole(creatorRole)), "FORBIDDEN");
}

export function requireCreatorHierarchy(
  ctx: AdminActorContext,
  resource: CreatorHierarchyResource,
  creatorRole: unknown,
): Response | null {
  if (ctx.role === "super_admin") return null;
  return requireActorCreatorHierarchy(ctx.actor, resource, creatorRole);
}
