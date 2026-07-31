import { apiError, dbError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { resolveAgentDraftOwnerScopesMap } from "@/lib/admin-scope-resolvers";
import {
  mapResourcePermissionRowsToScopes,
  type RawScopeRow,
} from "@/lib/adapters/access/_scope-utils";
import {
  hasPermission,
  type PermissionActor,
  type ResourceScope,
} from "@/lib/permission-actor";

export type AgentBindingSummary = {
  id: string;
  agent_code: string;
  name: string;
  platform: string;
  agent_type: string;
  published_from_draft_id: string | null;
};

type AgentBindingRow = AgentBindingSummary & {
  published_from_draft_id: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return apiError("智能体不存在", "NOT_FOUND");
}

/**
 * 批量返回 actor 可读的最小智能体摘要。
 *
 * service_role 会绕过 RLS，因此不能直接把 agents 外键关联结果返回给浏览器。
 * 本函数复用 agent adapter 的真实读取口径，并对无显式 permission 的已发布草稿
 * 保持创建者归属回退语义。不可读或不存在的 ID 不出现在结果 Map 中。
 */
export async function loadReadableAgentBindingSummaries(
  actor: PermissionActor,
  rawIds: string[],
): Promise<Map<string, AgentBindingSummary> | Response> {
  const ids = [...new Set(rawIds.filter((id) => UUID_RE.test(id)))];
  if (ids.length === 0) return new Map();

  const [agentsRes, permissionRes] = await Promise.all([
    db
      .from("agents")
      .select(
        "id, agent_code, name, platform, agent_type, published_from_draft_id",
      )
      .in("id", ids),
    db
      .from("resource_permissions")
      .select("resource_id, scope_type, scope_id")
      .eq("resource_type", "agent")
      .in("resource_id", ids),
  ]);

  if (agentsRes.error) {
    return dbError(agentsRes.error, "读取绑定智能体失败");
  }
  if (permissionRes.error) {
    return dbError(permissionRes.error, "读取智能体权限失败");
  }

  const rows = (agentsRes.data ?? []) as AgentBindingRow[];
  const rawScopeMap = new Map<string, RawScopeRow[]>();
  for (const row of (permissionRes.data ?? []) as Array<
    RawScopeRow & { resource_id: string }
  >) {
    const current = rawScopeMap.get(row.resource_id) ?? [];
    current.push({ scope_type: row.scope_type, scope_id: row.scope_id });
    rawScopeMap.set(row.resource_id, current);
  }

  const fallbackDraftIds = rows
    .filter(
      (row) =>
        (rawScopeMap.get(row.id) ?? []).length === 0 &&
        !!row.published_from_draft_id,
    )
    .map((row) => row.published_from_draft_id as string);
  const fallbackScopes = await resolveAgentDraftOwnerScopesMap(fallbackDraftIds);
  const scopesByAgent = new Map<string, ResourceScope[]>();
  for (const row of rows) {
    const rawScopes = rawScopeMap.get(row.id) ?? [];
    let scopes = mapResourcePermissionRowsToScopes(rawScopes);
    if (rawScopes.length === 0 && row.published_from_draft_id) {
      scopes = fallbackScopes.get(row.published_from_draft_id) ?? scopes;
    }
    scopesByAgent.set(row.id, scopes);
  }

  const [canReadAll, canReadOrg] = await Promise.all([
    hasPermission(actor, "agent.read.all"),
    hasPermission(actor, "agent.read.org"),
  ]);
  if (!canReadAll && (!canReadOrg || !actor.tenantCode)) return new Map();

  const deptIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const scopes of scopesByAgent.values()) {
    for (const scope of scopes) {
      if (scope.scope_type === "dept" && scope.scope_id) deptIds.add(scope.scope_id);
      if (scope.scope_type === "team" && scope.scope_id) teamIds.add(scope.scope_id);
    }
  }
  const [departmentsRes, teamsRes] = await Promise.all([
    deptIds.size > 0
      ? db.from("departments").select("id, tenant_code").in("id", [...deptIds])
      : Promise.resolve({ data: [], error: null }),
    teamIds.size > 0
      ? db.from("teams").select("id, tenant_code").in("id", [...teamIds])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (departmentsRes.error) return dbError(departmentsRes.error, "读取部门归属失败");
  if (teamsRes.error) return dbError(teamsRes.error, "读取小组归属失败");
  const deptTenantMap = new Map(
    ((departmentsRes.data ?? []) as { id: string; tenant_code: string }[])
      .map((row) => [row.id, row.tenant_code]),
  );
  const teamTenantMap = new Map(
    ((teamsRes.data ?? []) as { id: string; tenant_code: string }[])
      .map((row) => [row.id, row.tenant_code]),
  );

  function scopeWithinActorOrg(scope: ResourceScope) {
    if (!actor.tenantCode || scope.scope_type === "all") return false;
    if (scope.scope_type === "org") return scope.scope_id === actor.tenantCode;
    if (scope.scope_type === "dept") {
      return !!scope.scope_id && deptTenantMap.get(scope.scope_id) === actor.tenantCode;
    }
    if (scope.scope_type === "team") {
      return !!scope.scope_id && teamTenantMap.get(scope.scope_id) === actor.tenantCode;
    }
    return false;
  }

  const result = new Map<string, AgentBindingSummary>();
  for (const row of rows) {
      const scopes = scopesByAgent.get(row.id) ?? [];
      const readable = canReadAll || (
        canReadOrg &&
        !!actor.tenantCode &&
        scopes.every(scopeWithinActorOrg)
      );
      if (!readable) continue;
      result.set(row.id, {
        id: row.id,
        agent_code: row.agent_code,
        name: row.name,
        platform: row.platform,
        agent_type: row.agent_type,
        published_from_draft_id: row.published_from_draft_id,
      });
  }
  return result;
}

/**
 * 写入 workflow_steps.agent_id 前的最终授权边界。
 * 不存在与不可读统一返回 404，避免用状态码探测资源存在性。
 */
export async function requireReadableAgentForBinding(
  actor: PermissionActor,
  agentId: string,
): Promise<AgentBindingSummary | Response> {
  if (!UUID_RE.test(agentId)) {
    return apiError("智能体 ID 格式无效", "VALIDATION_ERROR");
  }
  const summaries = await loadReadableAgentBindingSummaries(actor, [agentId]);
  if (summaries instanceof Response) return summaries;
  return summaries.get(agentId) ?? notFound();
}
