/**
 * 6.4up v2 Phase A R1 (F5) · 权限管理 v2 默认包 seed 生成脚本
 *
 * 用途：把 v52 migration 内 system_admin / org_admin 两段 INSERT 重新算出来，
 *      与手写 SQL diff=0 验证"矩阵驱动可复算"语义。
 *
 * 输入：lib/permission-keys/admin.ts 的 ADMIN_PERMISSION_KEYS / KEYS_BY_RESOURCE
 * 输出：可粘到 migration 的 SQL 片段（stdout）
 *
 * 用法：
 *   npx tsx scripts/generate-permission-seed.ts > /tmp/seed-from-script.sql
 *   diff <(awk '/INSERT INTO builtin_role_permissions/,/ON CONFLICT/' supabase/migration_v52_permission_v2.sql) /tmp/seed-from-script.sql
 *   # 期望：0 行 diff
 *
 * D3（小A 倾向，用户拍板）：默认包业务规则**显式列在本脚本里**，不抽公共 lib。
 *   - 一处定义，对账即看脚本
 *   - 矩阵改动 → 改脚本 → 重跑 → 生成下一版 v53 migration 的 seed 段
 *
 * 自检：脚本启动时校验所有 seed 列出的 key 都在 ADMIN_PERMISSION_KEYS 中，
 *      防止脚本里出现"幽灵 key"过 lint 但 INSERT 落 DB 时无 CHECK 拦截。
 */

import {
  ADMIN_PERMISSION_KEYS,
  KEYS_BY_RESOURCE,
} from "../lib/permission-keys/admin";

// ─── 业务规则 · 显式列出 ─────────────────────────────────────────
//
// 来源：upgrade/6.4up/矩阵-资源权限现状-20260605.md `proposed_role_seed` 列
// 口径：与现状代码完全等价；零默默放权
//
// SYSTEM_ADMIN 排除规则（v2 之前 system_admin 不能动的）：
//   - provider.create/update/delete.{org,all}（6 keys；现状仅 super 能管 provider 写）
//   - user.create.{org,all}（2 keys；现状全平台无人能通过 admin API 创建用户）
//
// ORG_ADMIN 入包规则（仅 .org 后缀 + 4 项例外）：
//   - workflow / agent / agent_draft / kb / provider / notice / user / dept / team / user_group 全 .org
//     + 4 项例外：tenant.read.all、category.* 4 个（org_admin 也能管全平台分类）、audit.read.org

const SYSTEM_ADMIN_EXCLUDE = new Set<string>([
  "provider.create.org",
  "provider.create.all",
  "provider.update.org",
  "provider.update.all",
  "provider.delete.org",
  "provider.delete.all",
  "user.create.org",
  "user.create.all",
]);

const ORG_ADMIN_EXTRA_NON_ORG = new Set<string>([
  "tenant.read.all",
  "category.read.all",
  "category.create.all",
  "category.update.all",
  "category.delete.all",
]);

// ORG_ADMIN 显式排除：与 v52 org_admin 段对账
//   - user.create.*：与 system_admin 同口径不含（现状全平台 admin 都不能 user.create）
const ORG_ADMIN_EXCLUDE = new Set<string>([
  "user.create.org",
  "user.create.all",
]);

function isSystemAdminKey(key: string): boolean {
  return !SYSTEM_ADMIN_EXCLUDE.has(key);
}

function isOrgAdminKey(key: string): boolean {
  if (ORG_ADMIN_EXCLUDE.has(key)) return false;
  if (ORG_ADMIN_EXTRA_NON_ORG.has(key)) return true;
  // .org / .team / .dept 后缀允许；.all 默认拒（被 ORG_ADMIN_EXTRA_NON_ORG 显式放行的例外）
  if (key.endsWith(".all")) return false;
  return true;
}

// ─── 注释行（与 v52 手写注释完全对齐） ──────────────────────────

type GroupMeta = { resource: string; commentSystem: string; commentOrg: string };

const GROUPS: GroupMeta[] = [
  {
    resource: "workflow",
    commentSystem: "-- workflow（24 keys：read/create/update + enable/duplicate/delete × team/dept/org/all）",
    commentOrg: "-- workflow（18 keys：team/dept/org × read/create/update/enable/duplicate/delete；不含 .all）",
  },
  { resource: "agent", commentSystem: "-- agent（9 keys）", commentOrg: "-- agent（4 keys，仅 org）" },
  { resource: "agent_draft", commentSystem: "-- agent_draft（14 keys）", commentOrg: "-- agent_draft（7 keys）" },
  { resource: "kb", commentSystem: "-- kb（8 keys）", commentOrg: "-- kb（4 keys）" },
  {
    resource: "provider",
    commentSystem: "-- provider（4 keys：仅 read + test；现状 system_admin 不能创建/修改/删除 provider）",
    commentOrg: "-- provider（5 keys：read + test + create/update/delete；org_admin 可全权管理本组织 provider）",
  },
  { resource: "notice", commentSystem: "-- notice（8 keys）", commentOrg: "-- notice（4 keys）" },
  {
    resource: "user",
    commentSystem: "-- user（16 keys：read + 7 sub-actions × org/all；不含 create）",
    commentOrg: "-- user（8 keys：read + 7 sub-actions × org；不含 create）",
  },
  { resource: "tenant", commentSystem: "-- tenant（4 keys，all only）", commentOrg: "-- tenant（1 key：仅 read.all 出自家）" },
  {
    resource: "category",
    commentSystem: "-- category（4 keys，all only）",
    commentOrg: "-- category（4 keys，all only —— 与现状一致：org_admin 也能管全平台分类）",
  },
  { resource: "dept", commentSystem: "-- dept（8 keys）", commentOrg: "-- dept（4 keys，仅 org）" },
  { resource: "team", commentSystem: "-- team（8 keys）", commentOrg: "-- team（4 keys，仅 org）" },
  { resource: "user_group", commentSystem: "-- user_group（8 keys）", commentOrg: "-- user_group（4 keys，仅 org）" },
  { resource: "audit", commentSystem: "-- audit（2 keys）", commentOrg: "-- audit（1 key）" },
];

// ─── 自检 ────────────────────────────────────────────────────────

function validateOrDie() {
  const allKeys = new Set<string>(ADMIN_PERMISSION_KEYS as readonly string[]);
  for (const r of GROUPS) {
    const list = KEYS_BY_RESOURCE[r.resource];
    if (!list) {
      console.error(`[seed-gen] GROUPS 列出 resource=${r.resource}，但 KEYS_BY_RESOURCE 没有`);
      process.exit(1);
    }
    for (const k of list) {
      if (!allKeys.has(k)) {
        console.error(`[seed-gen] KEYS_BY_RESOURCE.${r.resource} 含 ${k}，但 ADMIN_PERMISSION_KEYS 没有`);
        process.exit(1);
      }
    }
  }
  // KEYS_BY_RESOURCE 不能有 GROUPS 没覆盖的 resource
  const known = new Set(GROUPS.map((g) => g.resource));
  for (const r of Object.keys(KEYS_BY_RESOURCE)) {
    if (!known.has(r)) {
      console.error(`[seed-gen] KEYS_BY_RESOURCE 含 resource=${r}，但 GROUPS 没覆盖（缺中文注释行）`);
      process.exit(1);
    }
  }
}

// ─── 生成 ────────────────────────────────────────────────────────

function renderBlock(role: "system_admin" | "org_admin", roleLabel: string, predicate: (k: string) => boolean): string {
  const lines: string[] = [];
  lines.push("INSERT INTO builtin_role_permissions (role, permission_key) VALUES");

  const rows: string[] = [];
  let totalCount = 0;
  for (const g of GROUPS) {
    const keys = (KEYS_BY_RESOURCE[g.resource] ?? []).filter(predicate);
    if (keys.length === 0) continue;
    rows.push(`  ${role === "system_admin" ? g.commentSystem : g.commentOrg}`);
    for (const k of keys) {
      rows.push(`  ('${role}', '${k}'),`);
      totalCount++;
    }
  }
  // 末行去逗号
  if (rows.length > 0) {
    const last = rows.length - 1;
    rows[last] = rows[last].replace(/,$/, "");
  }
  lines.push(...rows);
  lines.push("ON CONFLICT (role, permission_key) DO NOTHING;");
  return `-- ${roleLabel}（${totalCount} keys）\n${lines.join("\n")}\n`;
}

function main() {
  validateOrDie();
  process.stdout.write(renderBlock("system_admin", "system_admin 默认包", isSystemAdminKey));
  process.stdout.write("\n");
  process.stdout.write(renderBlock("org_admin", "org_admin 默认包", isOrgAdminKey));
}

main();
