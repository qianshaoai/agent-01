// 6.4up v2 Phase A · audit_logs resource access adapter (read-only)
//
// audit_logs 表有 admin_tenant_code + resource_tenant_code（5.11up），
// 用于按组织过滤。Phase A stub 走 generic（按 admin_tenant_code 当 tenant_code），
// Phase C enforce 前可补强精确过滤口径。
import { buildTenantOwnedAdapter } from "./_generic";

export const auditAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "audit",
  table: "audit_logs",
  permissionPrefix: "audit",
});
