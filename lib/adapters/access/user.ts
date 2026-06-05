// 6.4up v2 Phase A · user resource access adapter
//
// users 表本身有 tenant_code 列；既是资源也是 actor 来源（不冲突）。
// 复杂结构性约束（5.11up canActOnRole 上下级、不能改自己等）由 lib/admin-permissions.ts
// 承担，Phase A stub 不复刻；Phase D enforce 前补 user-specific 判定。
import { buildTenantOwnedAdapter } from "./_generic";

export const userAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "user",
  table: "users",
  permissionPrefix: "user",
});
