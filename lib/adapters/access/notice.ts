// 6.4up v2 Phase A · notice resource access adapter
import { buildTenantOwnedAdapter } from "./_generic";

export const noticeAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "notice",
  table: "notices",
  permissionPrefix: "notice",
});
