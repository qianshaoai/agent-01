// 6.4up v2 Phase A · team resource access adapter
// 注：teams 表无 tenant_code 列，需通过 dept_id 反查；本 Phase 用 generic stub，
//   loadDetail 返回的 row 缺 tenant_code 时 fallback 到 .all scope —— 与现状 team
//   route 内"按 dept.tenant_code 闸门"语义近似但不精确；Phase D enforce 启用前可补强。
import { buildTenantOwnedAdapter } from "./_generic";

export const teamAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "team",
  table: "teams",
  permissionPrefix: "team",
});
