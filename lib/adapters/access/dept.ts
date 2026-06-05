// 6.4up v2 Phase A · department resource access adapter
import { buildTenantOwnedAdapter } from "./_generic";

export const deptAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "dept",
  table: "departments",
  permissionPrefix: "dept",
});
