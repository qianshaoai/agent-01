// 6.4up v2 Phase D · D-0 · agent_draft（搭建器草稿）resource access adapter
//
// agent_drafts 表无 tenant_code，有 created_by。归属 = 创建者 admins/users.tenant_code（R0.1 §5.3）。
// Phase A stub 套 generic（select id, tenant_code）在 enforce 下会因列不存在 → 404；本次重写为
// created_by → admins/users.tenant_code 反查。AGENT_DRAFT keys 只有 .org/.all。
// 性能：每次多查一次 creator（主键索引 maybeSingle）；本期不加 cache（YAGNI，量级可接受）。
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { ResourceScope } from "@/lib/permission-actor";
import { resolveAgentDraftOwnerScopesById } from "@/lib/admin-scope-resolvers";
import { scopesFromTenantCode } from "./_scope-utils";
import { checkAnyScopedPermission } from "./_generic";

type AgentDraftRow = { id: string; scopes: ResourceScope[] };

// agent_draft key 只有 org / all 两档
const AGENT_DRAFT_SUFFIXES = ["all", "org"] as const;

export const agentDraftAccessAdapter: ResourceAccessAdapter<AgentDraftRow> = {
  resourceKind: "agent_draft",

  listFilter: () => null,

  async loadDetail(id) {
    const scopes = await resolveAgentDraftOwnerScopesById(id);
    if (!scopes) return null;
    return { id, scopes };
  },

  async checkRead(actor, row) {
    return checkAnyScopedPermission(actor, "agent_draft", "read", row.scopes, AGENT_DRAFT_SUFFIXES);
  },

  async checkWrite(actor, row, action) {
    // action ∈ update / publish / duplicate / test / delete
    return checkAnyScopedPermission(actor, "agent_draft", action, row.scopes, AGENT_DRAFT_SUFFIXES);
  },

  async checkCreate(actor) {
    // 创建者在自身 org（或全局 .all）建草稿
    return checkAnyScopedPermission(
      actor,
      "agent_draft",
      "create",
      scopesFromTenantCode(actor.tenantCode),
      AGENT_DRAFT_SUFFIXES,
    );
  },

  resolveCreateOwnership() {
    return {};
  },
};

registerAccessAdapter(agentDraftAccessAdapter);
