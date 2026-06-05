// 6.4up v2 Phase A · workflow resource access adapter (骨架 stub)
//
// workflows 表无 tenant_code 列；归属由 resource_permissions（5.7up）+
// created_by/created_by_role（5.11up）联合判定。Phase A 阶段用 generic stub，
// 仅按 .all scope fallback —— 由于 flag 空时 facade no-op，adapter 是死代码，
// 行为完全等价 6.4up。
//
// Phase D enforce 启用前必须重写：
//   - loadDetail 反查 resource_permissions 拿 workflow 的 scope_type/scope_id 列表
//   - checkRead / checkWrite 用 hasPermission(actor, workflow.{action}.{scope}, scopes)
//   - resolveCreateOwnership 注入 actor 的 tenantCode + 写 resource_permissions
import { buildTenantOwnedAdapter } from "./_generic";

export const workflowAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "workflow",
  table: "workflows",
  permissionPrefix: "workflow",
});
