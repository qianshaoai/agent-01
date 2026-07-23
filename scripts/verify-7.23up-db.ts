import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
const indexDecisionPath = process.env.INDEX_DECISION_FILE;
assert.ok(connectionString, "缺少 DATABASE_URL，无法执行 7.23up 数据库验收");
assert.ok(
  indexDecisionPath,
  "缺少 INDEX_DECISION_FILE；必须根据执行计划逐项决定候选索引是否创建",
);

const client = new Client({
  connectionString,
  ssl: process.env.PGSSL_DISABLE === "true"
    ? undefined
    : { rejectUnauthorized: false },
});

const requiredRelations = [
  "public.agent_effective_admin_scopes",
] as const;

const requiredFunctions = [
  "public.admin_usage_summary(text,timestamp with time zone)",
  "public.admin_user_usage_page(text,timestamp with time zone,uuid,uuid,text,integer,integer)",
  "public.admin_visible_agent_count(boolean,text)",
  "public.admin_agent_center_page(text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text,integer,integer)",
] as const;

const candidateIndexes = [
  "conversations_agent_id_idx",
  "workflow_steps_agent_id_idx",
  "agent_knowledge_bases_agent_id_idx",
] as const;
type IndexDecision = {
  decision: "create" | "not_required";
  beforePlan: string;
  afterPlan?: string;
  rationale: string;
};
const indexDecisions = JSON.parse(
  readFileSync(indexDecisionPath, "utf8"),
) as Record<string, IndexDecision>;
const indexDecisionDirectory = dirname(resolve(indexDecisionPath));

function assertEvidenceFile(path: string, label: string): void {
  const absolutePath = resolve(indexDecisionDirectory, path);
  assert.ok(existsSync(absolutePath), `${label}证据文件不存在：${absolutePath}`);
  assert.ok(readFileSync(absolutePath, "utf8").trim(), `${label}证据文件为空：${absolutePath}`);
}

try {
  await client.connect();

  for (const relation of requiredRelations) {
    const result = await client.query<{
      oid: string | null;
      anon_select: boolean;
      authenticated_select: boolean;
      service_select: boolean;
    }>(
      `SELECT
         to_regclass($1)::text AS oid,
         COALESCE(has_table_privilege('anon', to_regclass($1), 'SELECT'), false) AS anon_select,
         COALESCE(has_table_privilege('authenticated', to_regclass($1), 'SELECT'), false) AS authenticated_select,
         COALESCE(has_table_privilege('service_role', to_regclass($1), 'SELECT'), false) AS service_select`,
      [relation],
    );
    const row = result.rows[0];
    assert.ok(row?.oid, `缺少关系：${relation}`);
    assert.equal(row.anon_select, false, `${relation} 仍允许 anon 查询`);
    assert.equal(row.authenticated_select, false, `${relation} 仍允许 authenticated 查询`);
    assert.equal(row.service_select, true, `${relation} 未授权 service_role 查询`);
  }

  for (const fn of requiredFunctions) {
    const result = await client.query<{
      exists: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
    }>(
      `SELECT
         to_regprocedure($1) IS NOT NULL AS exists,
         COALESCE(has_function_privilege('anon', to_regprocedure($1), 'EXECUTE'), false) AS anon_execute,
         COALESCE(has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE'), false) AS authenticated_execute,
         COALESCE(has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE'), false) AS service_execute`,
      [fn],
    );
    const row = result.rows[0];
    assert.ok(row?.exists, `缺少函数：${fn}`);
    assert.equal(row.anon_execute, false, `${fn} 仍允许 anon 执行`);
    assert.equal(row.authenticated_execute, false, `${fn} 仍允许 authenticated 执行`);
    assert.equal(row.service_execute, true, `${fn} 未授权 service_role 执行`);
  }

  const indexResult = await client.query<{ indexname: string; valid: boolean }>(
    `SELECT i.relname AS indexname, x.indisvalid AS valid
       FROM pg_index AS x
       JOIN pg_class AS i ON i.oid = x.indexrelid
      WHERE i.relname = ANY($1::text[])`,
    [candidateIndexes],
  );
  const indexes = new Map(indexResult.rows.map((row) => [row.indexname, row.valid]));
  for (const index of candidateIndexes) {
    const decision = indexDecisions[index];
    assert.ok(decision, `缺少候选索引决策：${index}`);
    assert.ok(decision.beforePlan?.trim(), `${index} 缺少索引前执行计划证据`);
    assert.ok(decision.rationale?.trim(), `${index} 缺少创建/不创建理由`);
    assertEvidenceFile(decision.beforePlan, `${index} 索引前`);
    if (decision.decision === "create") {
      const afterPlan = decision.afterPlan;
      if (!afterPlan?.trim()) {
        assert.fail(`${index} 缺少索引后执行计划证据`);
      }
      assertEvidenceFile(afterPlan, `${index} 索引后`);
      assert.equal(indexes.get(index), true, `已决定创建但索引缺失或无效：${index}`);
    } else {
      assert.equal(
        decision.decision,
        "not_required",
        `${index} 的 decision 只能是 create/not_required`,
      );
    }
  }

  console.log("[verify-7.23up-db] OK · View/RPC 权限与候选索引执行计划决策均已验收");
} finally {
  await client.end().catch(() => undefined);
}
