import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const orgTreeRoute = read("app/api/admin/org-tree/route.ts");
assert.ok(orgTreeRoute.includes("resolveOrgTreeAccess"));
assert.ok(
  !orgTreeRoute.includes('endsWith(".read.all")'),
  "组织树不得用任意 *.read.all 判断全量权限",
);

const analyticsRoute = read("app/api/admin/analytics/route.ts");
for (const fragment of [
  'requestedView === "users"',
  'requestedView === "summary"',
  "needsSummary",
  "needsUsers",
  "userUsage.slice(start, start + pageSize)",
]) {
  assert.ok(analyticsRoute.includes(fragment), `Analytics legacy 回退缺少：${fragment}`);
}

const requestLogger = read("lib/request-logger.ts");
assert.ok(
  !requestLogger.includes("res.clone().arrayBuffer()"),
  "请求日志不得为统计响应字节复制完整响应体",
);

const session = read("lib/session.ts");
assert.ok(
  session.includes("requireActiveBuiltinOrg"),
  "builtin org_admin 必须实时校验组织状态",
);

const loadTest = read("scripts/loadtest-7.23up.ts");
for (const fragment of [
  "/api/admin/performance-readiness",
  "averageResponseBytes",
  "databaseSamples",
  "databaseCpuEvidence",
  "sample.endpoint === endpoint",
]) {
  assert.ok(loadTest.includes(fragment), `压测门禁缺少：${fragment}`);
}

console.log("[check-7.23up-runtime] OK · P0/P1/P2 运行时回归约束已锁定");

