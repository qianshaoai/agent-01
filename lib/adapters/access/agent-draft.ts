// 6.4up v2 Phase A · agent_draft (搭建器草稿) resource access adapter (骨架 stub)
//
// agent_drafts 表有 created_by；归属反查 users(created_by).tenant_code。Phase A stub 用
// generic fallback；Phase D enforce 前补：loadDetail 反查 users.tenant_code 注入到 row。
import { buildTenantOwnedAdapter } from "./_generic";

export const agentDraftAccessAdapter = buildTenantOwnedAdapter({
  resourceKind: "agent_draft",
  table: "agent_drafts",
  permissionPrefix: "agent_draft",
});
