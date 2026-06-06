// 6.4up v2 Phase A · tenant resource access adapter (platform-level)
import { buildPlatformAdapter } from "./_generic";

export const tenantAccessAdapter = buildPlatformAdapter({
  resourceKind: "tenant",
  table: "tenants",
  permissionPrefix: "tenant",
});
