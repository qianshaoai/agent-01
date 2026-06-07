// 6.4up v2 Phase D · D-0 · agent（已发布智能体）resource access adapter（resource_permissions 反查）
//
// agents 表无 tenant_code；可见性 / 归属来自 resource_permissions（resource_type='agent'，
// 与 app/api/admin/agents/route.ts GET 列表口径同源）。R0.1 §5.2 修正：归属源是 resource_permissions
// 而**非** tenant_agents（Phase A stub 的 generic select id, tenant_code 会因列不存在 → 404）。
//
// AGENT_KEYS 只有 .org/.all（reindex 仅 .all）；若 resource_permissions 含 dept/team scope 行，
// hasPermission 在 .org 判定里按 isScopeWithinOrg 收敛到 org（dept/team 归属落本组织即可）。
// agent POST 创建走 legacy role-only（决策 D9=b），不经 facade（checkCreate 返 false）。
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { ResourceScope } from "@/lib/permission-actor";
import { db } from "@/lib/db";
import { resolveAgentDraftOwnerScopesById } from "@/lib/admin-scope-resolvers";
import { mapResourcePermissionRowsToScopes, RawScopeRow } from "./_scope-utils";
import { checkAnyScopedPermission } from "./_generic";

type AgentRow = { id: string; scopes: ResourceScope[] };

// agent key 只有 org / all 两档
const AGENT_SUFFIXES = ["all", "org"] as const;

export const agentAccessAdapter: ResourceAccessAdapter<AgentRow> = {
  resourceKind: "agent",

  listFilter: () => null,

  async loadDetail(id) {
    const { data: a } = await db
      .from("agents")
      .select("id, published_from_draft_id")
      .eq("id", id)
      .maybeSingle();
    if (!a) return null;
    const { data: rows } = await db
      .from("resource_permissions")
      .select("scope_type, scope_id")
      .eq("resource_type", "agent")
      .eq("resource_id", id);
    const rawRows = (rows ?? []) as RawScopeRow[];
    let scopes = mapResourcePermissionRowsToScopes(rawRows);
    if (rawRows.length === 0 && a.published_from_draft_id) {
      scopes =
        (await resolveAgentDraftOwnerScopesById(a.published_from_draft_id)) ??
        scopes;
    }
    return { id, scopes };
  },

  async checkRead(actor, row) {
    return checkAnyScopedPermission(actor, "agent", "read", row.scopes, AGENT_SUFFIXES);
  },

  async checkWrite(actor, row, action) {
    // action ∈ basic.update / reindex / enable / delete（reindex 仅 .all key，.org 自然 miss）
    return checkAnyScopedPermission(actor, "agent", action, row.scopes, AGENT_SUFFIXES);
  },

  async checkCreate() {
    // 决策 D9=b：agent POST 走 legacy role-only（super/system 可建、org_admin 硬拒），不经 v2 facade。
    return false;
  },

  resolveCreateOwnership() {
    return {};
  },
};

registerAccessAdapter(agentAccessAdapter);
