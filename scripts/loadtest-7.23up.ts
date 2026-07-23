import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const baseUrl = process.env.LOADTEST_BASE_URL?.replace(/\/$/, "");
const adminCookie = process.env.LOADTEST_ADMIN_COOKIE;
const connectionString = process.env.DATABASE_URL;
const cpuEvidencePath = process.env.LOADTEST_DB_CPU_EVIDENCE;
const rounds = Math.max(1, Number(process.env.LOADTEST_ROUNDS ?? 3));

assert.ok(baseUrl, "缺少 LOADTEST_BASE_URL");
assert.ok(adminCookie, "缺少 LOADTEST_ADMIN_COOKIE（只填写 Cookie 值，不要提交到仓库）");
assert.ok(connectionString, "缺少 DATABASE_URL，无法记录数据库连接和锁指标");
assert.ok(
  cpuEvidencePath,
  "缺少 LOADTEST_DB_CPU_EVIDENCE；请提供数据库平台导出的 before/during/after CPU JSON",
);
type CpuSample = { at: string; cpuPercent: number };
const cpuEvidence = JSON.parse(readFileSync(cpuEvidencePath, "utf8")) as {
  before: CpuSample[];
  during: CpuSample[];
  after: CpuSample[];
};
for (const phase of ["before", "during", "after"] as const) {
  assert.ok(
    Array.isArray(cpuEvidence[phase]) &&
    cpuEvidence[phase].length > 0 &&
    cpuEvidence[phase].every(
      (sample) =>
        typeof sample.at === "string" &&
        Number.isFinite(sample.cpuPercent),
    ),
    `数据库 CPU 证据 ${phase} 必须包含 at/cpuPercent 样本`,
  );
}

const endpoints = [
  "/api/admin/dashboard-summary",
  "/api/admin/analytics?view=summary&days=30",
  "/api/admin/analytics?view=users&days=30&page=1&pageSize=20",
  "/api/admin/agent-center?page=1&pageSize=20",
] as const;

type Sample = {
  concurrency: number;
  endpoint: string;
  durationMs: number;
  responseBytes: number;
  ok: boolean;
  status: number;
};

type DbSample = {
  at: string;
  totalConnections: number;
  activeConnections: number;
  waitingConnections: number;
  ungrantedLocks: number;
};

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return Number(sorted[Math.max(0, index)].toFixed(1));
}

const cookieHeader = `ai_portal_admin_token=${adminCookie}`;

async function getReadiness() {
  const response = await fetch(`${baseUrl}/api/admin/performance-readiness`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  assert.equal(response.ok, true, `读取 V2/Node 状态失败：HTTP ${response.status}`);
  return response.json() as Promise<{
    flags: {
      dashboardSummaryV2: boolean;
      analyticsSqlAgg: boolean;
      agentCenterV2: boolean;
    };
    node: {
      pid: number;
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
    };
  }>;
}

async function hit(endpoint: string, concurrency: number): Promise<Sample> {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    const body = await response.arrayBuffer();
    return {
      concurrency,
      endpoint,
      durationMs: performance.now() - startedAt,
      responseBytes: body.byteLength,
      ok: response.ok,
      status: response.status,
    };
  } catch {
    return {
      concurrency,
      endpoint,
      durationMs: performance.now() - startedAt,
      responseBytes: 0,
      ok: false,
      status: 0,
    };
  }
}

const dbClient = new Client({
  connectionString,
  ssl: process.env.PGSSL_DISABLE === "true"
    ? undefined
    : { rejectUnauthorized: false },
});

async function sampleDb(): Promise<DbSample> {
  const result = await dbClient.query<{
    total_connections: string;
    active_connections: string;
    waiting_connections: string;
    ungranted_locks: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database())::text AS total_connections,
       (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active')::text AS active_connections,
       (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event IS NOT NULL)::text AS waiting_connections,
       (SELECT COUNT(*) FROM pg_locks WHERE NOT granted)::text AS ungranted_locks`,
  );
  const row = result.rows[0];
  return {
    at: new Date().toISOString(),
    totalConnections: Number(row?.total_connections ?? 0),
    activeConnections: Number(row?.active_connections ?? 0),
    waitingConnections: Number(row?.waiting_connections ?? 0),
    ungrantedLocks: Number(row?.ungranted_locks ?? 0),
  };
}

await dbClient.connect();
try {
  const readinessBefore = await getReadiness();
  assert.deepEqual(
    readinessBefore.flags,
    {
      dashboardSummaryV2: true,
      analyticsSqlAgg: true,
      agentCenterV2: true,
    },
    "三个 V2 Flag 未全部开启，拒绝生成全量压测通过报告",
  );

  const samples: Sample[] = [];
  const databaseSamples: Record<number, DbSample[]> = {};
  const nodeSamples: Record<number, unknown[]> = {};

  for (const concurrency of [10, 50, 100]) {
    databaseSamples[concurrency] = [await sampleDb()];
    nodeSamples[concurrency] = [(await getReadiness()).node];
    for (let round = 0; round < rounds; round += 1) {
      const batch = Array.from({ length: concurrency }, (_, index) =>
        hit(endpoints[index % endpoints.length], concurrency),
      );
      const dbDuringPromise = new Promise<DbSample>((resolve, reject) => {
        setTimeout(() => void sampleDb().then(resolve, reject), 50);
      });
      const nodeDuringPromise = new Promise<Awaited<ReturnType<typeof getReadiness>>>(
        (resolve, reject) => {
          setTimeout(() => void getReadiness().then(resolve, reject), 50);
        },
      );
      const [batchSamples, dbDuring, nodeDuring] = await Promise.all([
        Promise.all(batch),
        dbDuringPromise,
        nodeDuringPromise,
      ]);
      samples.push(...batchSamples);
      databaseSamples[concurrency].push(dbDuring);
      nodeSamples[concurrency].push(nodeDuring.node);
    }
    databaseSamples[concurrency].push(await sampleDb());
    nodeSamples[concurrency].push((await getReadiness()).node);
  }

  const report = [10, 50, 100].flatMap((concurrency) =>
    endpoints.map((endpoint) => {
      const group = samples.filter(
        (sample) =>
          sample.concurrency === concurrency && sample.endpoint === endpoint,
      );
      const durations = group.map((sample) => sample.durationMs);
      const failures = group.filter((sample) => !sample.ok);
      return {
        concurrency,
        endpoint,
        requests: group.length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        p99Ms: percentile(durations, 99),
        averageResponseBytes: Math.round(
          group.reduce((sum, sample) => sum + sample.responseBytes, 0) /
          Math.max(group.length, 1),
        ),
        errorRate: Number((failures.length / group.length).toFixed(4)),
        statuses: Object.fromEntries(
          Array.from(new Set(group.map((sample) => sample.status))).map((status) => [
            status,
            group.filter((sample) => sample.status === status).length,
          ]),
        ),
      };
    }),
  );

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    rounds,
    flags: readinessBefore.flags,
    report,
    databaseSamples,
    nodeSamples,
    databaseCpuEvidence: cpuEvidence,
  }, null, 2));

  assert.equal(
    samples.some((sample) => !sample.ok),
    false,
    "压测出现非 2xx 响应，详见上方逐接口报告",
  );
} finally {
  await dbClient.end().catch(() => undefined);
}
