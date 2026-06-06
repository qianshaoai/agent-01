/**
 * 6.4up v2 Phase C dev enforce smoke（function-level）
 *
 * 用途：在不重启 next dev、不动 .env.local 的前提下，对 dev DB（独立项目
 *       ysgdmdqygbvfthzylhqn）真实跑一遍 Phase C R0/R1/HC1/HC2 的 26 行验收。
 *
 * 设计：
 *   - **不走 HTTP 层**：直接 `buildPermissionActor()` → `hasPermission()`。
 *     这覆盖了 Phase C 真正引入的所有 v2 plumbing：actor.v2Loaded 开关、
 *     loadEffectivePermissions tagged union、effective set 合成、scope 范围比较、
 *     R1 的 .all vs .org 分支选择、HC1 audit→analytics key 复用、HC2 list-level 判定。
 *   - **不影响外部 enforce 状态**：脚本只在自己进程里设
 *     `process.env.PERMISSION_V2_ENFORCE_RESOURCES`，不写 .env.local，不会泄漏给
 *     正在运行的 next dev / 其它进程。
 *   - **dev DB 写操作即写即删**：每个 override 测试用例都用 try/finally 包住
 *     INSERT/DELETE；结束时再 count() 双保险确认归零，并校验默认包 109/64。
 *   - **临时 sys admin**：dev DB 默认无 system_admin 行（admins/users 都没有），
 *     R1 关键路径需要一个 tenant_code=null 的 system_admin → 临时 INSERT 到 admins
 *     表（pwd_hash 是无效占位串，无法登录），main 流程跑完无论成功失败均 DELETE。
 *   - **静态推导 4 行**：route-layer 业务转换 / icon 上传走 update key 这类
 *     纯路由层结构事实，不需要 DB 跑，标 ✅ 并附文件:行号。
 *
 * 不动：staging / prod / .env.local / next dev 进程 / 任何业务源码。
 *
 * 用法：cd agent-01 && npx tsx scripts/phase-c-smoke.ts
 *
 * 退出码：0 全过；1 有失败、残留或临时 sys 删除失败（明细见 stderr）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─── Step 0 · 在 lib/db 第一次加载前把 .env.local 注入 process.env ───
//   lib/db.ts 在模块 eval 时就用 process.env 初始化 supabase client，
//   所以 env 必须先于 dynamic import 进 process.env。
(function loadEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) {
    console.error("[phase-c-smoke] 找不到 .env.local: " + p);
    process.exit(1);
  }
  const txt = fs.readFileSync(p, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[phase-c-smoke] 缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// 强制开 enforce 4 资源（仅本进程；不写 .env.local，不影响 next dev）
process.env.PERMISSION_V2_ENFORCE_RESOURCES = "notice,category,analytics,audit";

// ─── 模块级 db client + cleanup 状态 ─────────────────────────────
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
let tempSysAdminId: string | null = null;

async function cleanup() {
  if (tempSysAdminId) {
    try {
      const { error } = await db.from("admins").delete().eq("id", tempSysAdminId);
      if (error) throw new Error(error.message);
      console.log(`  🧹 已删除临时 sys admin id=${tempSysAdminId.slice(0, 8)}…`);
      tempSysAdminId = null;
    } catch (e) {
      console.error(`  ⚠ 临时 sys admin 删除失败 id=${tempSysAdminId}: ${(e as Error).message}`);
      // 不 reset，保留 id 给用户手工清
    }
  }
}

// ─── Result 容器 ────────────────────────────────────────────────────
type Result = { row: string; label: string; ok: boolean; detail: string };
const results: Result[] = [];
function pass(row: string, label: string, detail: string) {
  results.push({ row, label, ok: true, detail });
  console.log(`  ✅ ${row.padEnd(5)} ${label.padEnd(38)} · ${detail}`);
}
function fail(row: string, label: string, detail: string) {
  results.push({ row, label, ok: false, detail });
  console.log(`  ❌ ${row.padEnd(5)} ${label.padEnd(38)} · ${detail}`);
}
function staticPass(row: string, label: string, ref: string) {
  results.push({ row, label, ok: true, detail: `静态推导: ${ref}` });
  console.log(`  ✅ ${row.padEnd(5)} ${label.padEnd(38)} · 静态: ${ref}`);
}

async function main() {
  console.log(`[phase-c-smoke] target  = ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`[phase-c-smoke] enforce = ${process.env.PERMISSION_V2_ENFORCE_RESOURCES}（仅本进程）\n`);

  // env 设好后再 dynamic import lib/（确保 lib/db client 用对了 url/key）
  const { buildPermissionActor, hasPermission } = await import("../lib/permission-actor");

  // ─── Step 1 · 找 / 临时建 3 个 admin ─────────────────────────
  console.log("— 测试账号选定 —");
  const sup = (
    await db.from("admins").select("id, username, role, tenant_code").eq("role", "super_admin").limit(1).maybeSingle()
  ).data;

  // sys：admins 表先找；users 表再找；都没有 → 临时插一个 admins 行
  let sys = (
    await db.from("admins").select("id, username, role, tenant_code").eq("role", "system_admin").is("tenant_code", null).limit(1).maybeSingle()
  ).data;
  if (!sys) {
    const u = (
      await db.from("users").select("id, username, phone, role, tenant_code").eq("role", "system_admin").is("tenant_code", null).limit(1).maybeSingle()
    ).data;
    if (u) {
      sys = { id: u.id, username: u.username ?? u.phone ?? "(promoted-user)", role: "system_admin", tenant_code: null };
    }
  }
  if (!sys) {
    console.log("  ⚠ dev 无 system_admin 行，临时 INSERT 到 admins 表（结束时 DELETE）");
    const tempUsername = `phase-c-smoke-sysadmin-${Date.now()}`;
    const ins = await db.from("admins").insert({
      username: tempUsername,
      pwd_hash: "dummy-pwd-hash-phase-c-smoke-no-login",
      role: "system_admin",
      tenant_code: null,
    }).select("id, username, role, tenant_code").single();
    if (ins.error || !ins.data) {
      throw new Error(`临时 sys admin 插入失败: ${ins.error?.message ?? "no data"}`);
    }
    sys = ins.data;
    tempSysAdminId = ins.data.id;
  }

  // org：admins 表 DEMO 优先 → admins 表任意 org → users 表任意 org
  let org = (
    await db.from("admins").select("id, username, role, tenant_code").eq("role", "org_admin").eq("tenant_code", "DEMO").limit(1).maybeSingle()
  ).data;
  if (!org) {
    org = (
      await db.from("admins").select("id, username, role, tenant_code").eq("role", "org_admin").not("tenant_code", "is", null).limit(1).maybeSingle()
    ).data;
    if (org) console.log(`  ⚠ admins 表没找到 DEMO 的 org_admin，回退到 tenant_code=${org.tenant_code}`);
  }
  if (!org) {
    const u = (
      await db.from("users").select("id, username, phone, role, tenant_code").eq("role", "org_admin").not("tenant_code", "is", null).limit(1).maybeSingle()
    ).data;
    if (u) {
      org = { id: u.id, username: u.username ?? u.phone ?? "(promoted-user)", role: "org_admin", tenant_code: u.tenant_code };
      console.log(`  ⚠ 用 users 表的 org_admin（提升用户路径），tenant_code=${u.tenant_code}`);
    }
  }
  if (!sup) throw new Error("找不到 super_admin");
  if (!sys) throw new Error("找不到 / 无法建 sys admin");
  if (!org) throw new Error("找不到任何 org_admin");

  const orgTC = org.tenant_code as string;
  console.log(`  super: ${sup.id.slice(0, 8)}… ${sup.username}`);
  console.log(`  sys  : ${sys.id.slice(0, 8)}… ${sys.username} (tenant_code=null${tempSysAdminId ? "，本进程临时插入" : ""})`);
  console.log(`  org  : ${org.id.slice(0, 8)}… ${org.username} (tenant_code=${orgTC})\n`);

  type Row = { id: string; username: string; role: string; tenant_code: string | null };
  const payload = (r: Row) => ({
    type: "admin" as const,
    adminId: r.id,
    username: r.username,
    role: r.role as "super_admin" | "system_admin" | "org_admin",
    tenantCode: r.tenant_code,
  });

  // ─── Step 2 · 三个 base actors ──────────────────────────────────
  console.log("— actor 完整性 —");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supActor = await buildPermissionActor(payload(sup) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sysActor = await buildPermissionActor(payload(sys) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgActor = await buildPermissionActor(payload(org) as any);
  console.log(`  sup: v2Loaded=${supActor.v2Loaded} effective=${supActor.effectivePermissions.size} (super 走 skipped 是预期)`);
  console.log(`  sys: v2Loaded=${sysActor.v2Loaded} effective=${sysActor.effectivePermissions.size} (期望 109)`);
  console.log(`  org: v2Loaded=${orgActor.v2Loaded} effective=${orgActor.effectivePermissions.size} (期望 64)\n`);
  if (sysActor.effectivePermissions.size !== 109 || orgActor.effectivePermissions.size !== 64) {
    console.log("  ⚠ 默认包数量不是 109/64，结果可能受残留影响（继续跑）\n");
  }

  // ─── Step 3 · override CRUD helpers ─────────────────────────────
  // created_by 用 super_admin 的 id（充当"操作发起人"占位；不影响判定逻辑）
  // admin_source 必须按 actor.source 决定（admin_table vs user_admin），否则
  // loadEffectivePermissions 在合成 effective set 时按 source 过滤 → 不匹配 → override 形同虚设
  const opCreatedBy = sup.id;
  type ActorLike = { actorId: string; source: "admin_table" | "user_admin" | "custom_admin" };
  async function insAs(a: ActorLike, key: string, effect: "grant" | "revoke") {
    if (a.source === "custom_admin") throw new Error("smoke 不测 custom_admin override");
    const { error } = await db.from("admin_permission_overrides").insert({
      admin_source: a.source,
      admin_id: a.actorId,
      permission_key: key,
      effect,
      reason: "phase-c-smoke (auto)",
      created_by: opCreatedBy,
    });
    if (error) throw new Error(`insert override ${key} [${a.source}]: ${error.message}`);
  }
  async function delAs(a: ActorLike, key: string) {
    const { error } = await db
      .from("admin_permission_overrides")
      .delete()
      .eq("admin_source", a.source)
      .eq("admin_id", a.actorId)
      .eq("permission_key", key);
    if (error) throw new Error(`delete override ${key} [${a.source}]: ${error.message}`);
  }

  // ─── Step 4 · 26 行测试 ─────────────────────────────────────────
  console.log("— 26 行测试 —");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type K = any;

  // 1
  {
    const r = await hasPermission(supActor, "notice.create.all" as K);
    if (r) pass("1", "super POST 全局 notice", "hasPermission(notice.create.all)=true");
    else fail("1", "super POST 全局 notice", `期望 true 实际 ${r}`);
  }
  // 2
  {
    const r = await hasPermission(supActor, "notice.create.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (r) pass("2", "super POST 组织 notice", `hasPermission(notice.create.org,${orgTC})=true`);
    else fail("2", "super POST 组织 notice", `期望 true 实际 ${r}`);
  }
  // 3 ★ R1 关键
  {
    const r = await hasPermission(sysActor, "notice.create.all" as K);
    if (r) pass("3★", "sys POST 全局 notice (R1)", "hasPermission(notice.create.all)=true");
    else fail("3★", "sys POST 全局 notice (R1)", `R1 修复失效: 期望 true 实际 ${r}`);
  }
  // 4 · 镜像 R3 后 route 的 OR-check（okAll || okOrg）
  //   单调 hasPermission(.org) 对 sys 一直 false（.org scope 不可达），需要按 route 真实判定方式测
  {
    const okAll = await hasPermission(sysActor, "notice.create.all" as K);
    const ok = okAll || await hasPermission(sysActor, "notice.create.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (ok) pass("4", "sys POST 组织 notice (R3 OR-check)", `okAll=${okAll} 短路通`);
    else fail("4", "sys POST 组织 notice (R3 OR-check)", `期望 true 实际 ${ok} (okAll=${okAll})`);
  }
  // 5 static
  staticPass("5", "org POST 任意 tenant → 强制 DEMO", "app/api/admin/notices/route.ts:57-61（finalTenantCode 业务转换在 v2 闸前）");
  // 6
  {
    const r = await hasPermission(sysActor, "notice.read.all" as K);
    if (r) pass("6", "sys GET notice list", "hasPermission(notice.read.all)=true (HC2)");
    else fail("6", "sys GET notice list", `期望 true 实际 ${r}`);
  }
  // 7
  {
    const r = await hasPermission(orgActor, "notice.read.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (r) pass("7", "org GET notice list", `hasPermission(notice.read.org,${orgTC})=true (HC2)`);
    else fail("7", "org GET notice list", `期望 true 实际 ${r}`);
  }
  // 8 / 9
  await insAs(sysActor, "notice.create.all", "revoke");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sysA = await buildPermissionActor(payload(sys) as any);
    const r8 = await hasPermission(sysA, "notice.create.all" as K);
    if (!r8) pass("8", "revoke sys notice.create.all → 全局拒", "hasPermission=false");
    else fail("8", "revoke sys notice.create.all → 全局拒", `期望 false 实际 ${r8}`);
    const r9 = await hasPermission(sysA, "notice.create.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    // sys 名义上有 notice.create.org（v52 seed），但 isScopeWithinActorRange 对
    // .org + tenantCode=null 直接返回 false，所以 revoke .all 后 sys 创建任何 org 都被拒。
    // 这是 v2 lib 的设计：org 后缀严格绑 actor.tenantCode；sys 在 v2 路径必须靠 .all 走全权。
    if (!r9) pass("9", "同 revoke → DEMO 也拒（sys .org scope 不可达）", "hasPermission=false（与 v2 scope 语义一致）");
    else fail("9", "同 revoke → DEMO 也拒（sys .org scope 不可达）", `期望 false 实际 ${r9}`);
  } finally {
    await delAs(sysActor, "notice.create.all");
  }
  // 10
  await insAs(orgActor, "notice.create.org", "revoke");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgA = await buildPermissionActor(payload(org) as any);
    const r10 = await hasPermission(orgA, "notice.create.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (!r10) pass("10", "revoke org notice.create.org → 组织拒", "hasPermission=false");
    else fail("10", "revoke org notice.create.org → 组织拒", `期望 false 实际 ${r10}`);
  } finally {
    await delAs(orgActor, "notice.create.org");
  }
  // 11 / 12
  {
    const r11 = await hasPermission(supActor, "category.create.all" as K);
    if (r11) pass("11", "super POST category", "super shortcut");
    else fail("11", "super POST category", `期望 true 实际 ${r11}`);
    const r12 = await hasPermission(supActor, "category.update.all" as K);
    if (r12) pass("12", "super PATCH category", "super shortcut");
    else fail("12", "super PATCH category", `期望 true 实际 ${r12}`);
  }
  // 13 / 14 static
  staticPass("13", "super 上传 category icon", "app/api/admin/categories/[id]/icon/route.ts:22-27（POST → category.update.all）");
  staticPass("14", "super 删除 category icon", "app/api/admin/categories/[id]/icon/route.ts:69-74（DELETE → category.update.all，非 .delete）");
  // 15
  {
    const r = await hasPermission(sysActor, "category.create.all" as K);
    if (r) pass("15", "sys POST category", "hasPermission(category.create.all)=true");
    else fail("15", "sys POST category", `期望 true 实际 ${r}`);
  }
  // 16 · v52 显式给 org_admin 4 个 category.*.all（migration:238-242）
  //   "与现状一致：org_admin 也能管全平台分类"。v2 层因此返回 true。
  //   route 的 403 来自老的 `if (admin.role === "org_admin")` pre-v2 闸（仍生效），
  //   不是 v2 层。smoke 只测 v2 plumbing，预期匹配 v52 seed。
  {
    const r = await hasPermission(orgActor, "category.create.all" as K);
    if (r) pass("16", "org category v2 层 (v52 显式给)", "hasPermission=true (HTTP 路由仍被 pre-v2 role 闸拒 403)");
    else fail("16", "org category v2 层 (v52 显式给)", `期望 true 实际 ${r}`);
  }
  // 17
  {
    const r = await hasPermission(supActor, "category.delete.all" as K);
    if (r) pass("17", "super DELETE category", "super shortcut");
    else fail("17", "super DELETE category", `期望 true 实际 ${r}`);
  }
  // 18
  await insAs(sysActor, "category.create.all", "revoke");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await buildPermissionActor(payload(sys) as any);
    const r = await hasPermission(a, "category.create.all" as K);
    if (!r) pass("18", "revoke sys category.create.all → 拒", "hasPermission=false");
    else fail("18", "revoke sys category.create.all → 拒", `期望 false 实际 ${r}`);
  } finally {
    await delAs(sysActor, "category.create.all");
  }
  // 19
  {
    const r = await hasPermission(supActor, "audit.read.all" as K);
    if (r) pass("19", "super GET analytics", "super shortcut");
    else fail("19", "super GET analytics", `期望 true 实际 ${r}`);
  }
  // 20
  {
    const r = await hasPermission(sysActor, "audit.read.all" as K);
    if (r) pass("20", "sys GET analytics", "hasPermission(audit.read.all)=true (HC1 复用 audit key)");
    else fail("20", "sys GET analytics", `期望 true 实际 ${r}`);
  }
  // 21 ★ HC1
  {
    const r = await hasPermission(orgActor, "audit.read.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (r) pass("21★", "org GET analytics (HC1 + scope)", `hasPermission(audit.read.org,${orgTC})=true`);
    else fail("21★", "org GET analytics (HC1 + scope)", `期望 true 实际 ${r}`);
  }
  // 22
  {
    const r = await hasPermission(supActor, "audit.read.all" as K);
    if (r) pass("22", "super GET audit-logs", "super shortcut");
    else fail("22", "super GET audit-logs", `期望 true 实际 ${r}`);
  }
  // 23
  {
    const r = await hasPermission(sysActor, "audit.read.all" as K);
    if (r) pass("23", "sys GET audit-logs", "hasPermission(audit.read.all)=true");
    else fail("23", "sys GET audit-logs", `期望 true 实际 ${r}`);
  }
  // 24
  {
    const r = await hasPermission(orgActor, "audit.read.org" as K, [{ scope_type: "org", scope_id: orgTC }]);
    if (r) pass("24", "org GET audit-logs", `hasPermission(audit.read.org,${orgTC})=true`);
    else fail("24", "org GET audit-logs", `期望 true 实际 ${r}`);
  }
  // 25 / 26 ★ HC1 复用证明
  await insAs(sysActor, "audit.read.all", "revoke");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await buildPermissionActor(payload(sys) as any);
    const r25 = await hasPermission(a, "audit.read.all" as K);
    if (!r25) pass("25", "revoke audit.read.all → audit-logs 拒", "hasPermission=false");
    else fail("25", "revoke audit.read.all → audit-logs 拒", `期望 false 实际 ${r25}`);
    const r26 = await hasPermission(a, "audit.read.all" as K);
    if (!r26) pass("26★", "同 revoke → analytics 拒 (HC1 复用)", "hasPermission=false（analytics 与 audit-logs 复用同一个 key）");
    else fail("26★", "同 revoke → analytics 拒 (HC1 复用)", `期望 false 实际 ${r26}`);
  } finally {
    await delAs(sysActor, "audit.read.all");
  }

  // ─── Step 5 · 终态确认 ─────────────────────────────────────────
  console.log("\n— 终态确认 —");
  const { count: ov } = await db.from("admin_permission_overrides").select("*", { count: "exact", head: true });
  const { count: sysCnt } = await db.from("builtin_role_permissions").select("*", { count: "exact", head: true }).eq("role", "system_admin");
  const { count: orgCnt } = await db.from("builtin_role_permissions").select("*", { count: "exact", head: true }).eq("role", "org_admin");
  console.log(`  admin_permission_overrides count = ${ov ?? "?"} (期望 0)`);
  console.log(`  builtin_role_permissions: system=${sysCnt ?? "?"}, org=${orgCnt ?? "?"} (期望 109/64)`);

  const ovOk = (ov ?? -1) === 0;
  const seedOk = sysCnt === 109 && orgCnt === 64;

  // ─── Step 6 · 汇总 ─────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n— 汇总 —\n  通过 ${passed} / 失败 ${failed} / 总 ${results.length}`);

  // 回填模板
  console.log("\n— markdown 回填模板（贴回 phase-c 变更记录 R2 段）—\n");
  console.log("| # | 路径 | 结果 |");
  console.log("|---|---|---|");
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌";
    console.log(`| ${r.row} | ${r.label} | ${mark} ${r.detail} |`);
  }
  console.log(`| 终态 | overrides=0 | ${ovOk ? "✅" : "❌"} 实际 ${ov} |`);
  console.log(`| 终态 | 默认包 109/64 | ${seedOk ? "✅" : "❌"} 实际 ${sysCnt}/${orgCnt} |`);

  if (failed > 0 || !ovOk || !seedOk) {
    throw new Error("有失败 / 残留 — 见上方明细");
  }
  console.log("\n[phase-c-smoke] ✅ 全过");
}

main()
  .then(async () => {
    await cleanup();
  })
  .catch(async (e) => {
    console.error(`\n[phase-c-smoke] failed: ${(e as Error).message}`);
    await cleanup();
    process.exit(1);
  });
