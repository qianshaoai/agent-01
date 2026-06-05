// 6.4up v2 Phase A · knowledge_base resource access adapter
//   table: knowledge_bases / permissionPrefix: kb
import { buildTenantOwnedAdapter } from "./_generic";

export const kbAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "knowledge_base",
  table: "knowledge_bases",
  permissionPrefix: "kb",
});
