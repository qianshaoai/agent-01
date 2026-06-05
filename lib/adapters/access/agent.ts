// 6.4up v2 Phase A · agent (已发布智能体) resource access adapter (骨架 stub)
//
// agents 表无 tenant_code 列；归属由 tenant_agents M2M 表判定。Phase A stub 用 generic
// fallback；Phase D enforce 前补：loadDetail 反查 tenant_agents 拿可见 tenant_code 集，
// checkRead/checkWrite 校验 actor.tenantCode 是否落在该集合内。
import { buildTenantOwnedAdapter } from "./_generic";

export const agentAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "agent",
  table: "agents",
  permissionPrefix: "agent",
});
