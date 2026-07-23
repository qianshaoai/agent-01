import assert from "node:assert/strict";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, "缺少 DATABASE_URL，无法执行 Effective Scope 等价测试");

type AgentRow = { id: string; published_from_draft_id: string | null };
type PermissionRow = {
  resource_id: string;
  scope_type: string;
  scope_id: string | null;
};
type ScopeRow = {
  agent_id: string;
  scope_type: string;
  scope_id: string | null;
  scope_source: string;
};

const client = new Client({
  connectionString,
  ssl: process.env.PGSSL_DISABLE === "true"
    ? undefined
    : { rejectUnauthorized: false },
});

function normalized(rows: ScopeRow[]): string[] {
  return rows
    .map((row) =>
      [
        row.agent_id,
        row.scope_type,
        row.scope_type === "all" ? "" : row.scope_id ?? "",
        row.scope_source,
      ].join("|"),
    )
    .sort();
}

try {
  await client.connect();

  const [
    agentsResult,
    permissionsResult,
    draftsResult,
    adminsResult,
    usersResult,
    viewResult,
    departmentsResult,
    teamsResult,
    tenantsResult,
  ] = await Promise.all([
    client.query<AgentRow>("SELECT id::text, published_from_draft_id::text FROM public.agents"),
    client.query<PermissionRow>(
      `SELECT resource_id::text, scope_type, scope_id::text
         FROM public.resource_permissions
        WHERE resource_type = 'agent'`,
    ),
    client.query<{ id: string; created_by: string | null }>(
      "SELECT id::text, created_by::text FROM public.agent_drafts",
    ),
    client.query<{ id: string; tenant_code: string | null }>(
      "SELECT id::text, tenant_code FROM public.admins",
    ),
    client.query<{ id: string; tenant_code: string | null }>(
      "SELECT id::text, tenant_code FROM public.users",
    ),
    client.query<ScopeRow>(
      `SELECT agent_id::text, scope_type, scope_id::text, scope_source
         FROM public.agent_effective_admin_scopes`,
    ),
    client.query<{ id: string; tenant_code: string }>(
      "SELECT id::text, tenant_code FROM public.departments",
    ),
    client.query<{ id: string; tenant_code: string }>(
      "SELECT id::text, tenant_code FROM public.teams",
    ),
    client.query<{ code: string }>("SELECT code FROM public.tenants"),
  ]);

  const permissionsByAgent = new Map<string, PermissionRow[]>();
  for (const row of permissionsResult.rows) {
    const rows = permissionsByAgent.get(row.resource_id) ?? [];
    rows.push(row);
    permissionsByAgent.set(row.resource_id, rows);
  }
  const drafts = new Map(draftsResult.rows.map((row) => [row.id, row]));
  const adminTenants = new Map(adminsResult.rows.map((row) => [row.id, row.tenant_code]));
  const userTenants = new Map(usersResult.rows.map((row) => [row.id, row.tenant_code]));

  const expected: ScopeRow[] = [];
  for (const agent of agentsResult.rows) {
    const rawPermissions = permissionsByAgent.get(agent.id) ?? [];
    if (rawPermissions.length > 0) {
      for (const permission of rawPermissions) {
        if (!["all", "org", "dept", "team"].includes(permission.scope_type)) continue;
        expected.push({
          agent_id: agent.id,
          scope_type: permission.scope_type,
          scope_id: permission.scope_type === "all" ? null : permission.scope_id,
          scope_source: "explicit",
        });
      }
      continue;
    }

    const draft = agent.published_from_draft_id
      ? drafts.get(agent.published_from_draft_id)
      : undefined;
    if (!draft) continue;
    const ownerTenant = draft.created_by
      ? adminTenants.get(draft.created_by) ?? userTenants.get(draft.created_by) ?? null
      : null;
    expected.push({
      agent_id: agent.id,
      scope_type: ownerTenant ? "org" : "all",
      scope_id: ownerTenant,
      scope_source: "draft_owner_fallback",
    });
  }

  assert.deepEqual(
    normalized(viewResult.rows),
    normalized(expected),
    "agent_effective_admin_scopes 与 TypeScript resolver 语义不等价",
  );

  const actualByAgent = new Map<string, ScopeRow[]>();
  for (const row of viewResult.rows) {
    const rows = actualByAgent.get(row.agent_id) ?? [];
    rows.push(row);
    actualByAgent.set(row.agent_id, rows);
  }
  const deptTenants = new Map(departmentsResult.rows.map((row) => [row.id, row.tenant_code]));
  const teamTenants = new Map(teamsResult.rows.map((row) => [row.id, row.tenant_code]));

  const coverage = {
    multiScope: false,
    allPlusOther: false,
    emptyScope: false,
    invalidDeptOrTeam: false,
    onlyNonAdminPermissionRows: false,
    coalesceAdminNullUserNonNull: false,
  };

  for (const agent of agentsResult.rows) {
    const scopes = actualByAgent.get(agent.id) ?? [];
    const rawPermissions = permissionsByAgent.get(agent.id) ?? [];
    if (scopes.length >= 2) coverage.multiScope = true;
    if (
      scopes.some((scope) => scope.scope_type === "all") &&
      scopes.some((scope) => scope.scope_type !== "all")
    ) {
      coverage.allPlusOther = true;
    }
    if (scopes.length === 0) coverage.emptyScope = true;
    if (
      scopes.some((scope) =>
        (scope.scope_type === "dept" && !deptTenants.has(scope.scope_id ?? "")) ||
        (scope.scope_type === "team" && !teamTenants.has(scope.scope_id ?? "")),
      )
    ) {
      coverage.invalidDeptOrTeam = true;
    }
    if (
      rawPermissions.length > 0 &&
      rawPermissions.every((permission) => !["all", "org", "dept", "team"].includes(permission.scope_type))
    ) {
      coverage.onlyNonAdminPermissionRows = true;
    }

    const draft = agent.published_from_draft_id
      ? drafts.get(agent.published_from_draft_id)
      : undefined;
    if (
      rawPermissions.length === 0 &&
      draft?.created_by &&
      adminTenants.has(draft.created_by) &&
      adminTenants.get(draft.created_by) === null &&
      Boolean(userTenants.get(draft.created_by))
    ) {
      coverage.coalesceAdminNullUserNonNull = true;
    }
  }

  for (const [name, covered] of Object.entries(coverage)) {
    assert.equal(
      covered,
      true,
      `真实数据库缺少等价测试夹具：${name}；请在专用测试库补齐后重跑`,
    );
  }

  for (const tenant of tenantsResult.rows) {
    const expectedVisible = agentsResult.rows.filter((agent) => {
      const scopes = actualByAgent.get(agent.id) ?? [];
      return scopes.every((scope) => {
        if (scope.scope_type === "all") return false;
        if (scope.scope_type === "org") return scope.scope_id === tenant.code;
        if (scope.scope_type === "dept") {
          return deptTenants.get(scope.scope_id ?? "") === tenant.code;
        }
        if (scope.scope_type === "team") {
          return teamTenants.get(scope.scope_id ?? "") === tenant.code;
        }
        return false;
      });
    }).length;
    const rpcResult = await client.query<{ count: string }>(
      "SELECT public.admin_visible_agent_count(false, $1)::text AS count",
      [tenant.code],
    );
    assert.equal(
      Number(rpcResult.rows[0]?.count ?? -1),
      expectedVisible,
      `admin_visible_agent_count 与 AND/fail-closed 语义不等价：tenant=${tenant.code}`,
    );
  }

  console.log(
    "[verify-7.23up-equivalence] OK · View/Resolver 逐行等价、边界夹具齐全、组织计数 AND 语义一致",
  );
} finally {
  await client.end().catch(() => undefined);
}

