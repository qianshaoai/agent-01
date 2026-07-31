import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function containsAll(source: string, fragments: string[]): void {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `缺少 7.28up 关键片段：${fragment}`);
  }
}

const pickerSql = read("supabase/migration_v60_admin_agent_picker_rpc.sql");
containsAll(pickerSql, [
  "SECURITY INVOKER",
  "SET search_path = pg_catalog, public",
  "FROM public.agent_effective_admin_scopes",
  "ORDER BY f.name ASC, f.id ASC",
  "FROM PUBLIC, anon, authenticated",
  "TO service_role",
]);

const workflowSql = read("supabase/migration_v61_admin_workflow_page_rpc.sql");
containsAll(workflowSql, [
  "SECURITY INVOKER",
  "SET search_path = pg_catalog, public",
  "stats_base AS",
  "page_base AS",
  "row_number() OVER (ORDER BY pb.sort_order ASC, pb.id ASC)",
  "FROM public.resource_permissions",
  "FROM PUBLIC, anon, authenticated",
  "TO service_role",
]);
assert.ok(!workflowSql.includes("SECURITY DEFINER"), "v61 禁止使用 SECURITY DEFINER");

const pickerRoute = read("app/api/admin/agents/picker/page/route.ts");
containsAll(pickerRoute, [
  'process.env.ADMIN_AGENT_PICKER_V2 !== "true"',
  'db.rpc("admin_agent_picker_page"',
  "contractVersion: 2",
]);

const workflowRoute = read("app/api/admin/workflows/route.ts");
containsAll(workflowRoute, [
  'process.env.ADMIN_WORKFLOW_PAGE_V2 === "true"',
  'db.rpc("admin_workflow_page"',
  '.in("resource_id", pageWorkflowIds)',
  "loadReadableAgentBindingSummaries",
]);

const workflowsPage = read("app/admin/(console)/workflows/page.tsx");
containsAll(workflowsPage, [
  "/api/admin/agents/picker/page?",
  "workflowAbortRef.current?.abort()",
  "currentAgent={stepAgent}",
]);
assert.ok(
  !workflowsPage.includes('fetch("/api/admin/agents/picker")'),
  "工作流首屏不得再请求旧的全量 Picker",
);

for (const path of [
  "app/api/admin/workflows/[id]/steps/route.ts",
  "app/api/admin/workflow-steps/[id]/route.ts",
]) {
  containsAll(read(path), [
    "requireReadableAgentForBinding",
    "智能体",
  ]);
}

const indexSql = read("supabase/ops/7.28up_pagination_indexes.sql");
containsAll(indexSql, [
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS agents_name_id_idx",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS workflows_sort_order_id_idx",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_categories_category_workflow_idx",
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS resource_permissions_type_scope_resource_idx",
]);
const executableIndexSql = indexSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
assert.ok(!/\bBEGIN\b|\bCOMMIT\b/i.test(executableIndexSql), "CONCURRENTLY 索引脚本不得放在事务中");

console.log("[check-7.28up-migrations] OK · 分页、鉴权、脱敏和 RPC 安全门禁已固化");
