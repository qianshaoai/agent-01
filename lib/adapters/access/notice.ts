// 6.4up v2 Phase A · notice resource access adapter
import { buildTenantOwnedAdapter } from "./_generic";

export const noticeAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "notice",
  table: "notices",
  permissionPrefix: "notice",
  // 6.6up Fix · 全局公告（tenant_code=NULL）对持任一 notice.read scope 的 org actor 可读
  publicReadableByOrg: true,
});
