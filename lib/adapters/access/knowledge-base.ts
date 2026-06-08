// 6.4up v2 Phase A · knowledge_base resource access adapter
//   table: knowledge_bases / permissionPrefix: kb
import { buildTenantOwnedAdapter } from "./_generic";

export const kbAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "knowledge_base",
  table: "knowledge_bases",
  permissionPrefix: "kb",
  // 6.6up Fix · 平台公共知识库（tenant_code=NULL）对持任一 kb.read scope 的 org actor 可读
  publicReadableByOrg: true,
});
