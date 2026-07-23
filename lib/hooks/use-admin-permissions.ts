"use client";

import { useMemo } from "react";
import {
  type AdminRole,
  type AdminSource,
  useAdminSession,
} from "@/components/admin/admin-session-provider";

export type { AdminRole, AdminSource };
export type HierarchyResource = "agent" | "kb" | "workflow";

const SCOPES = ["team", "dept", "org", "all"] as const;
const ROLE_LEVEL: Record<AdminRole, number> = {
  super_admin: 3,
  system_admin: 2,
  org_admin: 1,
};

const CUSTOM_ALL_WRITE_KEYS: Record<HierarchyResource, readonly string[]> = {
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
  kb: [
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

export function useAdminPermissions() {
  const { me, status } = useAdminSession();
  const loaded = status === "ready" || (status === "error" && me !== null);

  return useMemo(() => {
    const role = me?.role ?? me?.builtinRole ?? null;
    const source = me?.source ?? null;
    const perms = new Set(me?.permissions ?? []);
    const isSuper = role === "super_admin";
    const isCustom = source === "custom_admin";

    const has = (key: string) => isSuper || perms.has(key);
    const canAny = (keys: string[]) => isSuper || keys.some((key) => perms.has(key));
    const canAction = (resource: string, action: string) => (
      isSuper || SCOPES.some((scope) => perms.has(`${resource}.${action}.${scope}`))
    );
    const actorHierarchyRole = (resource: HierarchyResource): AdminRole | null => {
      if (role) return role;
      if (!isCustom) return null;
      return CUSTOM_ALL_WRITE_KEYS[resource].some((key) => perms.has(key))
        ? "system_admin"
        : "org_admin";
    };
    const canActOnCreator = (resource: HierarchyResource, creatorRole: unknown) => {
      if (isSuper) return true;
      const actorRole = actorHierarchyRole(resource);
      if (!actorRole) return false;
      const creator = normalizeCreatorRole(creatorRole);
      return ROLE_LEVEL[actorRole] >= ROLE_LEVEL[creator];
    };

    return {
      loaded,
      source,
      role,
      isSuper,
      isCustom,
      tenantCode: me?.tenantCode ?? null,
      deptId: me?.deptId ?? null,
      teamId: me?.teamId ?? null,
      perms,
      has,
      canAny,
      canAction,
      actorHierarchyRole,
      canActOnCreator,
    };
  }, [loaded, me]);
}
