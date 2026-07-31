import assert from "node:assert/strict";

const baseUrl = process.env.LOADTEST_BASE_URL?.replace(/\/$/, "");
const adminCookie = process.env.LOADTEST_ADMIN_COOKIE;
assert.ok(baseUrl, "缺少 LOADTEST_BASE_URL");
assert.ok(adminCookie, "缺少 LOADTEST_ADMIN_COOKIE（只填 token 值，不要提交仓库）");

const stages = (process.env.LOADTEST_STAGES ?? "5x30,10x60")
  .split(",")
  .map((value) => {
    const [concurrency, seconds] = value.split("x").map(Number);
    assert.ok(concurrency > 0 && seconds >= 10, `无效阶段：${value}，格式应为 并发x秒数`);
    return { concurrency, seconds };
  });
const searchRatio = Number(process.env.LOADTEST_SEARCH_RATIO ?? 0.3);
const pickerRatio = Number(process.env.LOADTEST_PICKER_RATIO ?? 0.35);
const terms = (process.env.LOADTEST_SEARCH_TERMS ?? "助手,客服,流程,coze")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
assert.ok(searchRatio >= 0 && searchRatio <= 1, "LOADTEST_SEARCH_RATIO 必须在 0~1");
assert.ok(pickerRatio >= 0 && pickerRatio <= 1, "LOADTEST_PICKER_RATIO 必须在 0~1");

const cookieHeader = `ai_portal_admin_token=${adminCookie}`;
type Sample = {
  stage: string;
  cachePhase: "cold" | "warm";
  endpoint: "picker" | "workflows";
  operation: "first_page" | "page_turn" | "search";
  durationMs: number;
  responseBytes: number;
  status: number;
  ok: boolean;
};
const samples: Sample[] = [];

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)].toFixed(1));
}

function chooseRequest() {
  const endpoint: Sample["endpoint"] = Math.random() < pickerRatio ? "picker" : "workflows";
  const roll = Math.random();
  const operation: Sample["operation"] =
    roll < searchRatio ? "search" : (roll < searchRatio + 0.35 ? "page_turn" : "first_page");
  const page = operation === "page_turn" ? 2 + Math.floor(Math.random() * 4) : 1;
  const params = new URLSearchParams({ page: String(page), pageSize: endpoint === "picker" ? "20" : "10" });
  if (operation === "search") {
    params.set("q", terms[Math.floor(Math.random() * terms.length)] ?? "助手");
  }
  return {
    endpoint,
    operation,
    path: endpoint === "picker"
      ? `/api/admin/agents/picker/page?${params}`
      : `/api/admin/workflows?${params}`,
  };
}

async function hit(stage: string, cachePhase: Sample["cachePhase"]) {
  const request = chooseRequest();
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${request.path}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    const body = await response.arrayBuffer();
    samples.push({
      stage,
      cachePhase,
      endpoint: request.endpoint,
      operation: request.operation,
      durationMs: performance.now() - startedAt,
      responseBytes: body.byteLength,
      status: response.status,
      ok: response.ok,
    });
  } catch {
    samples.push({
      stage,
      cachePhase,
      endpoint: request.endpoint,
      operation: request.operation,
      durationMs: performance.now() - startedAt,
      responseBytes: 0,
      status: 0,
      ok: false,
    });
  }
}

const readinessResponse = await fetch(`${baseUrl}/api/admin/performance-readiness`, {
  headers: { cookie: cookieHeader },
  cache: "no-store",
});
assert.equal(readinessResponse.ok, true, `readiness HTTP ${readinessResponse.status}`);
const readiness = await readinessResponse.json() as {
  flags?: { agentPickerV2?: boolean; workflowPageV2?: boolean };
};
assert.equal(readiness.flags?.agentPickerV2, true, "ADMIN_AGENT_PICKER_V2 尚未开启");
assert.equal(readiness.flags?.workflowPageV2, true, "ADMIN_WORKFLOW_PAGE_V2 尚未开启");

for (const stage of stages) {
  const stageName = `${stage.concurrency}x${stage.seconds}s`;
  const stageStartedAt = performance.now();
  const deadline = stageStartedAt + stage.seconds * 1000;
  await Promise.all(Array.from({ length: stage.concurrency }, async () => {
    while (performance.now() < deadline) {
      const elapsed = performance.now() - stageStartedAt;
      await hit(stageName, elapsed < Math.min(5000, stage.seconds * 100) ? "cold" : "warm");
    }
  }));
}

const groups = new Map<string, Sample[]>();
for (const sample of samples) {
  const key = `${sample.stage}/${sample.cachePhase}/${sample.endpoint}/${sample.operation}`;
  groups.set(key, [...(groups.get(key) ?? []), sample]);
}
const summary = [...groups.entries()].map(([key, rows]) => {
  const durations = rows.map((row) => row.durationMs);
  const errors = rows.filter((row) => !row.ok);
  return {
    key,
    requests: rows.length,
    errors: errors.length,
    errorRate: Number((errors.length / rows.length).toFixed(4)),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    avgResponseBytes: Math.round(rows.reduce((sum, row) => sum + row.responseBytes, 0) / rows.length),
    statuses: Object.fromEntries(
      [...new Set(rows.map((row) => row.status))].map((status) => [
        status,
        rows.filter((row) => row.status === status).length,
      ]),
    ),
  };
});

console.log(JSON.stringify({
  config: { baseUrl, stages, searchRatio, pickerRatio, terms },
  readiness: readiness.flags,
  generatedAt: new Date().toISOString(),
  totalRequests: samples.length,
  summary,
}, null, 2));
