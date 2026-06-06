// 6.4up v2 Phase D · D-0 · agent_draft（搭建器草稿）resource access adapter
//
// agent_drafts 表无 tenant_code，有 created_by。归属 = 创建者 users.tenant_code（R0.1 §5.3）。
// Phase A stub 套 generic（select id, tenant_code）在 enforce 下会因列不存在 → 404；本次重写为
// created_by → users.tenant_code 反查。AGENT_DRAFT keys 只有 .org/.all。
// 性能：每次多查一次 users（主键索引 maybeSingle）；本期不加 cache（YAGNI，量级可接受）。
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { ResourceScope } from "@/lib/permission-actor";
import { db } from "@/lib/db";
import { scopesFromTenantCode } from "./_scope-utils";
import { checkAnyScopedPermission } from "./_generic";

type AgentDraftRow = { id: string; scopes: ResourceScope[] };

// agent_draft key 只有 org / all 两档
const AGENT_DRAFT_SUFFIXES = ["all", "org"] as const;

export const agentDraftAccessAdapter: ResourceAccessAdapter<AgentDraftRow> = {
  resourceKind: "agent_draft",

  listFilter: () => null,

  async loadDetail(id) {
    const { data: draft } = await db
      .from("agent_drafts")
      .select("id, created_by")
      .eq("id", id)
      .maybeSingle();
    if (!draft) return null;
    let tenantCode: string | null = null;
    if (draft.created_by) {
      const { data: creator } = await db
        .from("users")
        .select("tenant_code")
        .eq("id", draft.created_by)
        .maybeSingle();
      tenantCode = (creator?.tenant_code as string | null) ?? null;
    }
    return { id, scopes: scopesFromTenantCode(tenantCode) };
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
