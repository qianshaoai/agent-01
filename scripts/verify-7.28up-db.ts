import assert from "node:assert/strict";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, "缺少 DATABASE_URL，无法执行 7.28up 数据库验收");

const client = new Client({
  connectionString,
  ssl: process.env.PGSSL_DISABLE === "true"
    ? undefined
    : { rejectUnauthorized: false },
});

const requiredFunctions = [
  "public.admin_agent_picker_page(text,boolean,boolean,text,integer,integer)",
  "public.admin_workflow_page(boolean,text,uuid,uuid,boolean,text,uuid,boolean,text,text,uuid,integer,integer)",
] as const;

try {
  await client.connect();
  for (const fn of requiredFunctions) {
    const result = await client.query<{
      exists: boolean;
      security_definer: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
      service_execute: boolean;
      search_path: string[] | null;
    }>(
      `SELECT
         to_regprocedure($1) IS NOT NULL AS exists,
         COALESCE(p.prosecdef, false) AS security_definer,
         COALESCE(has_function_privilege('anon', to_regprocedure($1), 'EXECUTE'), false) AS anon_execute,
         COALESCE(has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE'), false) AS authenticated_execute,
         COALESCE(has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE'), false) AS service_execute,
         p.proconfig AS search_path
       FROM pg_proc AS p
       WHERE p.oid = to_regprocedure($1)`,
      [fn],
    );
    const row = result.rows[0];
    assert.ok(row?.exists, `缺少函数：${fn}`);
    assert.equal(row.security_definer, false, `${fn} 不得为 SECURITY DEFINER`);
    assert.equal(row.anon_execute, false, `${fn} 仍允许 anon 执行`);
    assert.equal(row.authenticated_execute, false, `${fn} 仍允许 authenticated 执行`);
    assert.equal(row.service_execute, true, `${fn} 未授权 service_role 执行`);
    assert.ok(
      row.search_path?.some((value) => value.replace(/\s/g, "") === "search_path=pg_catalog,public"),
      `${fn} 未固定安全 search_path`,
    );
  }
  console.log("[verify-7.28up-db] OK · v60/v61 存在且仅 service_role 可执行");
} finally {
  await client.end().catch(() => undefined);
}
