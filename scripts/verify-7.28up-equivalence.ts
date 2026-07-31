import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const legacyBaseUrl = process.env.LEGACY_BASE_URL?.replace(/\/$/, "");
const v2BaseUrl = process.env.V2_BASE_URL?.replace(/\/$/, "");
const adminCookie = process.env.LOADTEST_ADMIN_COOKIE;
const fixturePath = process.env.EQUIVALENCE_FIXTURE;
assert.ok(legacyBaseUrl, "缺少 LEGACY_BASE_URL（关闭 7.28up flags 的实例）");
assert.ok(v2BaseUrl, "缺少 V2_BASE_URL（开启 7.28up flags 的实例）");
assert.ok(adminCookie, "缺少 LOADTEST_ADMIN_COOKIE");
assert.ok(fixturePath, "缺少 EQUIVALENCE_FIXTURE（超出旧上限时的独立 oracle）");

const headers = { cookie: `ai_portal_admin_token=${adminCookie}` };
type ApiPayload = {
  data?: Array<{
    id: string;
    name: string;
    agent_code: string;
    platform: string;
  }>;
  totalCount?: number;
  capped?: boolean;
  pagination?: {
    total?: number;
    focusFound?: boolean;
    focusPage?: number | null;
  };
  stats?: unknown;
};
async function get(baseUrl: string, path: string): Promise<ApiPayload> {
  const response = await fetch(`${baseUrl}${path}`, { headers, cache: "no-store" });
  const body = await response.json() as ApiPayload;
  assert.equal(response.ok, true, `${baseUrl}${path} HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

type WorkflowExpected = {
  query: string;
  expectedIds: string[];
  paginationTotal: number;
  stats: { total: number; ungrouped: number; categoryCounts: Record<string, number> };
  focusFound?: boolean;
  focusPage?: number | null;
};
type PickerExpected = {
  query: string;
  expectedIds: string[];
  total: number;
};
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  overLimit: {
    workflows: WorkflowExpected[];
    picker: PickerExpected[];
  };
};
assert.ok(Array.isArray(fixture.overLimit?.workflows), "fixture.overLimit.workflows 缺失");
assert.ok(Array.isArray(fixture.overLimit?.picker), "fixture.overLimit.picker 缺失");

function ids(payload: { data?: Array<{ id: string }> }) {
  return (payload.data ?? []).map((row) => row.id);
}
function normalizeStats(value: unknown) {
  const stats = (value ?? {}) as WorkflowExpected["stats"];
  return {
    total: stats.total ?? 0,
    ungrouped: stats.ungrouped ?? 0,
    categoryCounts: Object.fromEntries(
      Object.entries(stats.categoryCounts ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

// 第一档：旧实现上限以内，旧/新实例必须严格等价。
const withinLimitQueries = (process.env.EQUIVALENCE_QUERIES ?? ",助手,流程")
  .split(",")
  .map((value) => value.trim());
for (const q of withinLimitQueries) {
  const params = new URLSearchParams({ page: "1", pageSize: "50" });
  if (q) params.set("q", q);

  const legacyPicker = await get(legacyBaseUrl, "/api/admin/agents/picker");
  const v2Picker = await get(v2BaseUrl, `/api/admin/agents/picker/page?${params}`);
  assert.equal(legacyPicker.capped, false, "上限内等价测试数据已触发旧 Picker 2000 条截断");
  const needle = q.toLocaleLowerCase();
  const legacyPickerRows = ([...(legacyPicker.data ?? [])] as Array<{
    id: string;
    name: string;
    agent_code: string;
    platform: string;
  }>).filter((row) =>
    !needle ||
    [row.name, row.agent_code, row.platform].join(" ").toLocaleLowerCase().includes(needle)
  );
  legacyPickerRows.sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id));
  assert.deepEqual(ids(v2Picker), legacyPickerRows.slice(0, 50).map((row) => row.id), `Picker ID/顺序不等价 q=${q}`);
  assert.equal(v2Picker.pagination?.total, legacyPickerRows.length, `Picker total 不等价 q=${q}`);

  const legacyWorkflow: ApiPayload = await get(
    legacyBaseUrl,
    `/api/admin/workflows?${params}`,
  );
  const v2Workflow: ApiPayload = await get(
    v2BaseUrl,
    `/api/admin/workflows?${params}`,
  );
  assert.deepEqual(ids(v2Workflow), ids(legacyWorkflow), `Workflow ID/顺序不等价 q=${q}`);
  assert.equal(v2Workflow.pagination?.total, legacyWorkflow.pagination?.total, `Workflow total 不等价 q=${q}`);
  assert.deepEqual(normalizeStats(v2Workflow.stats), normalizeStats(legacyWorkflow.stats), `Workflow stats 不等价 q=${q}`);
}

// 第二档：超出 2000/5000 旧上限，只以独立 SQL/测试夹具为 oracle。
// 此处不比较旧接口，并明确允许旧路径与正确的新实现产生预期差异。
for (const expected of fixture.overLimit.picker) {
  const payload = await get(v2BaseUrl, `/api/admin/agents/picker/page?${expected.query}`);
  assert.deepEqual(ids(payload), expected.expectedIds, `超限 Picker ID/顺序错误：${expected.query}`);
  assert.equal(payload.pagination?.total, expected.total, `超限 Picker total 错误：${expected.query}`);
}
for (const expected of fixture.overLimit.workflows) {
  const payload = await get(v2BaseUrl, `/api/admin/workflows?${expected.query}`);
  assert.deepEqual(ids(payload), expected.expectedIds, `超限 Workflow ID/顺序错误：${expected.query}`);
  assert.equal(payload.pagination?.total, expected.paginationTotal, `超限 Workflow total 错误：${expected.query}`);
  assert.deepEqual(normalizeStats(payload.stats), normalizeStats(expected.stats), `超限 Workflow stats 错误：${expected.query}`);
  if (expected.focusFound !== undefined) {
    assert.equal(payload.pagination?.focusFound, expected.focusFound, `focusFound 错误：${expected.query}`);
    assert.equal(payload.pagination?.focusPage ?? null, expected.focusPage ?? null, `focusPage 错误：${expected.query}`);
  }
}

console.log("[verify-7.28up-equivalence] OK · 上限内严格等价，超限数据通过独立 fixture oracle");
