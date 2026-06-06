// 6.4up v2 Phase A · model_provider (API 管理) resource access adapter
//   table: model_providers / permissionPrefix: provider
//   注：现状 system_admin 不能 create/update/delete provider —— seed 已忠实复刻（验收 #16）
import { buildTenantOwnedAdapter } from "./_generic";

export const providerAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "model_provider",
  table: "model_providers",
  permissionPrefix: "provider",
});
