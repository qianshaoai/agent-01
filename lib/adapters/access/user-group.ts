// 6.6up · user_group resource access adapter
// user_groups has tenant_code ownership; membership changes use user_group.update.*.
import { buildTenantOwnedAdapter } from "./_generic";

export const userGroupAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "user_group",
  table: "user_groups",
  permissionPrefix: "user_group",
});
