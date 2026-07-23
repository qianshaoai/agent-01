/**
 * 6.4up v2 Phase D · D-0 · 纯逻辑单测：resource_permissions 行 → ResourceScope[] 映射
 *
 * 为什么是 tsx 脚本而非 vitest：本仓库无 jest/vitest 入口（见合并版 §7 / package.json）。
 * 沿用 scripts/check-permission-seed.ts 的 tsx + 退出码约定：
 *   0 → 全过；1 → 有失败（CI fail）。
 * 用法：npx tsx scripts/phase-d-scope-utils.test.ts
 *
 * 只测**不碰 DB** 的纯函数（lib/adapters/access/_scope-utils.ts）：
 *   - resource_permissions 的 scope_type 含 all/org/dept/team/user/user_type 六种；
 *   - 但 hasPermission 的 ResourceScope 只认 all/org/dept/team 四种；
 *   - 映射时必须丢弃 user / user_type（用户可见性维度，不参与 admin 权限 scope 判定）。
 * 这层过滤是 D-0 adapter 重写里最容易出 bug 的地方（漏过滤 = 把"指定用户可见"误当 org scope）。
 */

import {
  coalesceAdminUserTenantCode,
  mapResourcePermissionRowsToScopes,
  selectDuplicatePermRows,
  type RawScopeRow,
} from "../lib/adapters/access/_scope-utils";

let failed = 0;

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}\n     expected ${e}\n     actual   ${a}`);
  }
}

console.log("phase-d-scope-utils · mapResourcePermissionRowsToScopes");

// 1. org → 保留，scope_id = tenant_code
eq(
  "org 行保留",
  mapResourcePermissionRowsToScopes([{ scope_type: "org", scope_id: "DEMO" }]),
  [{ scope_type: "org", scope_id: "DEMO" }],
);

// 2. all → 保留，scope_id 归一为 null
eq(
  "all 行保留且 scope_id=null",
  mapResourcePermissionRowsToScopes([{ scope_type: "all", scope_id: null }]),
  [{ scope_type: "all", scope_id: null }],
);

// 3. dept + team → 都保留
eq(
  "dept + team 都保留",
  mapResourcePermissionRowsToScopes([
    { scope_type: "dept", scope_id: "d1" },
    { scope_type: "team", scope_id: "t1" },
  ]),
  [
    { scope_type: "dept", scope_id: "d1" },
    { scope_type: "team", scope_id: "t1" },
  ],
);

// 4. user / user_type → 全部丢弃（核心防呆）
eq(
  "user / user_type 被丢弃",
  mapResourcePermissionRowsToScopes([
    { scope_type: "user", scope_id: "u1" },
    { scope_type: "user_type", scope_id: "organization" },
  ]),
  [],
);

// 5. 混合：org + user → 只留 org
eq(
  "混合行只留 admin-hierarchy scope",
  mapResourcePermissionRowsToScopes([
    { scope_type: "org", scope_id: "DEMO" },
    { scope_type: "user", scope_id: "u1" },
  ]),
  [{ scope_type: "org", scope_id: "DEMO" }],
);

// 6. 空输入 → 空数组
eq("空输入→空数组", mapResourcePermissionRowsToScopes([] as RawScopeRow[]), []);

// 7. 未知 scope_type → 丢弃（fail-closed，不当成 all）
eq(
  "未知 scope_type 丢弃",
  mapResourcePermissionRowsToScopes([{ scope_type: "galaxy", scope_id: "x" }]),
  [],
);

console.log("\nphase-d-scope-utils · coalesceAdminUserTenantCode");

eq(
  "admin tenant 非空时优先",
  coalesceAdminUserTenantCode("ADMIN_ORG", "USER_ORG"),
  "ADMIN_ORG",
);
eq(
  "admin tenant 为空时回退 user tenant",
  coalesceAdminUserTenantCode(null, "USER_ORG"),
  "USER_ORG",
);
eq(
  "admins 不存在时使用 user tenant",
  coalesceAdminUserTenantCode(undefined, "USER_ORG"),
  "USER_ORG",
);
eq(
  "两侧 tenant 都为空时保持 all 语义",
  coalesceAdminUserTenantCode(null, null),
  null,
);

// ─────────────────────────────────────────────────────────────
// 6.4up v2 Phase D · D-3 Fix · workflow duplicate 复制 resource_permissions
// 决策：super/system 原样克隆全部 scope 行；org_admin 只归一到本组织范围内的
//       org(==tenantCode)/dept(∈orgDeptIds)/team(∈orgTeamIds)，其余一律丢弃。
// ─────────────────────────────────────────────────────────────
console.log("\nphase-d-scope-utils · selectDuplicatePermRows");

const DUP_SRC: RawScopeRow[] = [
  { scope_type: "all", scope_id: null },
  { scope_type: "org", scope_id: "DEMO" },
  { scope_type: "org", scope_id: "OTHER" },
  { scope_type: "dept", scope_id: "d_in" },
  { scope_type: "dept", scope_id: "d_out" },
  { scope_type: "team", scope_id: "t_in" },
  { scope_type: "user", scope_id: "u1" },
  { scope_type: "user_type", scope_id: "organization" },
];

// D1. super_admin → 原样克隆全部行（含 all/user/user_type）
eq(
  "super_admin 原样克隆全部 scope 行",
  selectDuplicatePermRows(DUP_SRC, {
    role: "super_admin",
    tenantCode: null,
    orgDeptIds: new Set(),
    orgTeamIds: new Set(),
  }),
  DUP_SRC,
);

// D2. system_admin → 同样原样克隆
eq(
  "system_admin 原样克隆全部 scope 行",
  selectDuplicatePermRows(DUP_SRC, {
    role: "system_admin",
    tenantCode: "IGNORED",
    orgDeptIds: new Set(["d_in"]),
    orgTeamIds: new Set(["t_in"]),
  }),
  DUP_SRC,
);

// D3. org_admin → 只留本组织 org/dept/team，丢 all/跨组织/user/user_type
eq(
  "org_admin 归一到本组织范围",
  selectDuplicatePermRows(DUP_SRC, {
    role: "org_admin",
    tenantCode: "DEMO",
    orgDeptIds: new Set(["d_in"]),
    orgTeamIds: new Set(["t_in"]),
  }),
  [
    { scope_type: "org", scope_id: "DEMO" },
    { scope_type: "dept", scope_id: "d_in" },
    { scope_type: "team", scope_id: "t_in" },
  ],
);

// D4. org_admin · org 行 tenantCode 不符 → 丢弃（不会误把别组织 org 行复制过来）
eq(
  "org_admin · org scope_id 与 tenantCode 不符则丢",
  selectDuplicatePermRows(
    [
      { scope_type: "org", scope_id: "OTHER" },
      { scope_type: "org", scope_id: "DEMO" },
    ],
    {
      role: "org_admin",
      tenantCode: "DEMO",
      orgDeptIds: new Set(),
      orgTeamIds: new Set(),
    },
  ),
  [{ scope_type: "org", scope_id: "DEMO" }],
);

if (failed > 0) {
  console.error(`\n❌ ${failed} 个断言失败`);
  process.exit(1);
}
console.log("\n✅ 全部通过");
