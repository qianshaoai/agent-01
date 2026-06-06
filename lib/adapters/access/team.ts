// 6.4up v2 Phase D · D-0 · team resource access adapter
// R0.1 修正：teams 表自 migration_v13 起**有 tenant_code 列**（早期注释误写"无"）；
//   故 generic tenant-owned adapter 列层面可用，loadDetail 的 select id, tenant_code 正常返回。
import { buildTenantOwnedAdapter } from "./_generic";

export const teamAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "team",
  table: "teams",
  permissionPrefix: "team",
});
