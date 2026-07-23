import assert from "node:assert/strict";
import { resolveOrgTreeAccess } from "@/lib/admin-org-tree-access";

assert.deepEqual(
  resolveOrgTreeAccess({
    role: "org_admin",
    permissionKeys: ["tenant.read.all", "dept.read.all", "team.read.all"],
    tenantCode: "ORG_A",
    deptId: null,
    teamId: null,
  }),
  { kind: "org", id: "ORG_A" },
  "org_admin 即使持完整 all 权限也必须锁定本组织",
);

assert.deepEqual(
  resolveOrgTreeAccess({
    role: "system_admin",
    permissionKeys: ["tenant.read.all", "dept.read.all", "team.read.all"],
    tenantCode: null,
    deptId: null,
    teamId: null,
  }),
  { kind: "all" },
);

assert.deepEqual(
  resolveOrgTreeAccess({
    role: "custom_admin",
    permissionKeys: ["agent.read.all"],
    tenantCode: "ORG_A",
    deptId: null,
    teamId: null,
  }),
  { kind: "deny" },
  "任意业务资源 read.all 不能升级组织树权限",
);

assert.deepEqual(
  resolveOrgTreeAccess({
    role: "custom_admin",
    permissionKeys: ["dept.read.org"],
    tenantCode: "ORG_A",
    deptId: "DEPT_A",
    teamId: null,
  }),
  { kind: "dept", id: "DEPT_A" },
);

console.log("[admin-org-tree-access] OK · org_admin 硬边界与显式层级权限通过");

