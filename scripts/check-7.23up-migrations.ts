import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(name: string): string {
  return readFileSync(resolve(process.cwd(), "supabase", name), "utf8");
}

function containsAll(sql: string, fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(sql.includes(fragment), `缺少安全/语义片段：${fragment}`);
  }
}

const viewSql = read("migration_v57_agent_effective_admin_scopes.sql");
containsAll(viewSql, [
  "WITH (security_invoker = true)",
  "COALESCE(ad.tenant_code, u.tenant_code)",
  "FROM public.resource_permissions AS rp_any",
  "rp_any.resource_id = a.id",
  "REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM PUBLIC",
  "REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM anon",
  "REVOKE ALL ON TABLE public.agent_effective_admin_scopes FROM authenticated",
  "GRANT SELECT ON TABLE public.agent_effective_admin_scopes TO service_role",
]);

const analyticsSql = read("migration_v58_admin_analytics_rpc.sql");
containsAll(analyticsSql, [
  "SECURITY INVOKER",
  "GROUP BY l.tenant_code, l.user_phone",
  "LEFT JOIN LATERAL",
  "GROUP BY l.agent_code",
  "NOT EXISTS (",
  "d.tenant_code IS DISTINCT FROM p_tenant_code",
  "tm.tenant_code IS DISTINCT FROM p_tenant_code",
  "FROM PUBLIC, anon, authenticated",
  "TO service_role",
]);

const agentCenterSql = read("migration_v59_admin_agent_center_rpc.sql");
containsAll(agentCenterSql, [
  "SECURITY INVOKER",
  "FROM public.agent_effective_admin_scopes AS eas",
  "SELECT NOT EXISTS (",
  "eas.scope_type = 'all'",
  "d.tenant_code IS DISTINCT FROM p_tenant_code",
  "tm.tenant_code IS DISTINCT FROM p_tenant_code",
  "FROM fully_filtered",
  "FROM base",
  "FROM PUBLIC, anon, authenticated",
  "TO service_role",
]);

assert.ok(
  !/p_can_read_org\s+AND\s+EXISTS\s*\(/i.test(agentCenterSql),
  "Agent Center 可见性不得改为任一 effective scope 命中",
);

const indexSql = read("ops/7.23up_agent_center_indexes.sql");
containsAll(indexSql, [
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_agent_id_idx",
  "ON public.conversations(agent_id)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_steps_agent_id_idx",
  "ON public.workflow_steps(agent_id)",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS agent_knowledge_bases_agent_id_idx",
  "ON public.agent_knowledge_bases(agent_id)",
]);
assert.ok(
  !/\bBEGIN\b|\bCOMMIT\b/i.test(
    indexSql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n"),
  ),
  "CONCURRENTLY 索引脚本不得包在事务中",
);

console.log("[check-7.23up-migrations] OK · View/RPC 安全与关键权限语义已固化");
