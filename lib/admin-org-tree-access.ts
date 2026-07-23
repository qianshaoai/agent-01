export type OrgTreeActorRole =
  | "super_admin"
  | "system_admin"
  | "org_admin"
  | "custom_admin";

export type OrgTreeAccess =
  | { kind: "all" }
  | { kind: "org"; id: string }
  | { kind: "dept"; id: string }
  | { kind: "team"; id: string }
  | { kind: "deny" };

export function resolveOrgTreeAccess(input: {
  role: OrgTreeActorRole;
  permissionKeys: Iterable<string>;
  tenantCode: string | null;
  deptId: string | null;
  teamId: string | null;
}): OrgTreeAccess {
  const permissions = new Set(input.permissionKeys);
  if (input.role === "super_admin") return { kind: "all" };

  // org_admin 是硬组织边界；即使默认包包含 tenant.read.all 也绝不升级为全平台。
  if (input.role === "org_admin") {
    return input.tenantCode
      ? { kind: "org", id: input.tenantCode }
      : { kind: "deny" };
  }

  const hasCompleteHierarchyAll =
    permissions.has("tenant.read.all") &&
    permissions.has("dept.read.all") &&
    permissions.has("team.read.all");
  if (hasCompleteHierarchyAll) return { kind: "all" };

  const hasScopedHierarchyRead =
    permissions.has("dept.read.org") ||
    permissions.has("team.read.org");
  if (!hasScopedHierarchyRead) return { kind: "deny" };
  if (input.teamId) return { kind: "team", id: input.teamId };
  if (input.deptId) return { kind: "dept", id: input.deptId };
  if (input.tenantCode) return { kind: "org", id: input.tenantCode };
  return { kind: "deny" };
}

