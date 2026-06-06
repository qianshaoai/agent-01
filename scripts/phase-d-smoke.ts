/**
 * 6.4up v2 Phase D dev enforce smoke（function-level）
 *
 * 覆盖 Phase D（D-0 adapter 重写 + D-1~D-6 enforce）的核心判定，不走 HTTP、不重启 next dev、
 * 不写 .env.local（仅本进程设 PERMISSION_V2_ENFORCE_RESOURCES）。
 *
 * 分两类：
 *   A. **数据无关**（不需 dev DB v52 / 业务数据）：直接构造 fake PermissionActor 调 hasPermission：
 *        - builtin builtinRole=null → 一律拒（F 收口 fail-closed；即使 effectivePermissions 里有 key）
 *        - custom_admin actor 对 ADMIN-only key（user.delete.all / kb.delete.all）拒（双通道隔离）
 *        - _scope-utils 纯映射过滤 user/user_type（D-0 核心，已在 phase-d-scope-utils.test.ts 单测，这里复跑）
 *   B. **数据相关**（需 dev DB 已跑 v52 + 有样本行）：guard 起来，缺数据则 SKIP 不 fail：
 *        - generic checkCreate 双形态修复（临时 sys admin + grant kb.create.all override → checkCreate=true；撤销→false）
 *        - 4 个重写 adapter 的 loadDetail 对真实样本行返回非 null + scopes 形态正确（不再 404）
 *
 * 临时 sys admin / override 均 try/finally 即写即删；终态 count 双保险。
 *
 * 用法：cd agent-01 && npx tsx scripts/phase-d-smoke.ts
 * 退出码：0 全过（SKIP 不算失败）；1 有失败或残留。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─── env 注入（必须先于 lib/db 动态 import） ───
(function loadEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) {
    console.error("[phase-d-smoke] 找不到 .env.local: " + p);
    process.exit(1);
  }
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[phase-d-smoke] 缺 SUPABASE env");
  process.exit(1);
}

// 本进程开全部 D 资源 enforce（不写 .env.local）
process.env.PERMISSION_V2_ENFORCE_RESOURCES =
  "user,agent,agent_draft,workflow,tenant,dept,team,knowledge_base,model_provider";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let failed = 0;
let skipped = 0;
let tempSysAdminId: string | null = null;
const overridesToClear: Array<{ admin_source: string; admin_id: string; permission_key: string }> = [];

function ok(label: string, detail: string) {
  console.log(`  ✅ ${label.padEnd(46)} · ${detail}`);
}
function bad(label: string, detail: string) {
  failed++;
  console.error(`  ❌ ${label.padEnd(46)} · ${detail}`);
}
function skip(label: string, detail: string) {
  skipped++;
  console.log(`  ⏭  ${label.padEnd(46)} · SKIP: ${detail}`);
}

async function cleanup() {
  for (const o of overridesToClear) {
    await db.from("admin_permission_overrides").delete()
      .eq("admin_source", o.admin_source).eq("admin_id", o.admin_id).eq("permission_key", o.permission_key);
  }
  if (tempSysAdminId) {
    const { error } = await db.from("admins").delete().eq("id", tempSysAdminId);
    if (error) console.error(`  ⚠ 临时 sys admin 删除失败 id=${tempSysAdminId}: ${error.message}`);
    else console.log(`  🧹 已删除临时 sys admin id=${tempSysAdminId.slice(0, 8)}…`);
  }
}

async function main() {
  const { buildPermissionActor, hasPermission } = await import("@/lib/permission-actor");
  const { mapResourcePermissionRowsToScopes } = await import("@/lib/adapters/access/_scope-utils");
  const { getAccessAdapter } = await import("@/lib/access-registry");
  await import("@/lib/adapters/access"); // bootstrap REGISTRY

  type Actor = Awaited<ReturnType<typeof buildPermissionActor>>;

  // ───────── A. 数据无关 ─────────
  console.log("\nA · 数据无关（fail-closed / 双通道隔离 / 纯映射）");

  // A1 · builtin builtinRole=null → 一律拒（即使 effectivePermissions 里塞了 key）
  const nullRoleActor = {
    actorId: "fake", source: "admin_table", tenantCode: null, deptId: null, teamId: null,
    userType: null, builtinRole: null, customRoleCodes: [], permissions: new Set(),
    v2Loaded: true, effectivePermissions: new Set(["user.delete.all"]), username: "fake",
  } as unknown as Actor;
  if ((await hasPermission(nullRoleActor, "user.delete.all")) === false) {
    ok("A1 builtinRole=null → hasPermission 拒", "即便 effectivePermissions 含该 key 仍 false");
  } else {
    bad("A1 builtinRole=null → hasPermission 拒", "期望 false，实际 true（fail-closed 失效）");
  }

  // A2 · custom_admin actor 对 ADMIN-only key 拒（双通道隔离）
  const customActor = {
    actorId: "fakec", source: "custom_admin", tenantCode: "DEMO", deptId: null, teamId: null,
    userType: "organization", builtinRole: null, customRoleCodes: ["group_leader"],
    permissions: new Set(["workflow.update.team"]), v2Loaded: false, effectivePermissions: new Set(),
    username: "fakec",
  } as unknown as Actor;
  const cUser = await hasPermission(customActor, "user.delete.all");
  const cKb = await hasPermission(customActor, "kb.delete.all");
  if (cUser === false && cKb === false) {
    ok("A2 custom_admin 对 admin-only key 拒", "user.delete.all / kb.delete.all 均 false");
  } else {
    bad("A2 custom_admin 对 admin-only key 拒", `user=${cUser} kb=${cKb}（期望 false/false）`);
  }

  // A3 · _scope-utils 过滤 user/user_type
  const mapped = mapResourcePermissionRowsToScopes([
    { scope_type: "org", scope_id: "DEMO" },
    { scope_type: "user", scope_id: "u1" },
    { scope_type: "user_type", scope_id: "organization" },
  ]);
  if (mapped.length === 1 && mapped[0].scope_type === "org") {
    ok("A3 scope 映射丢弃 user/user_type", JSON.stringify(mapped));
  } else {
    bad("A3 scope 映射丢弃 user/user_type", JSON.stringify(mapped));
  }

  // ───────── B. 数据相关（guard） ─────────
  console.log("\nB · 数据相关（需 dev DB 已跑 v52 + 样本行；缺则 SKIP）");

  // 探测 v52 是否就绪
  const { error: v52Err } = await db.from("builtin_role_permissions").select("role").limit(1);
  const v52Ready = !v52Err;
  if (!v52Ready) {
    skip("B* 全部数据相关用例", "dev DB 未跑 v52（builtin_role_permissions 不存在）");
  } else {
    // B1 · generic checkCreate 双形态：临时 sys admin（tenant_code=null）+ grant kb.create.all → checkCreate=true
    const tmpId = crypto.randomUUID();
    const { error: insErr } = await db.from("admins").insert({
      id: tmpId, username: `__smoke_sys_${tmpId.slice(0, 8)}`,
      pwd_hash: "invalid:smoke-cannot-login", role: "system_admin", tenant_code: null,
    });
    if (insErr) {
      skip("B1 generic checkCreate .all 修复", `临时 sys admin 建失败: ${insErr.message}`);
    } else {
      tempSysAdminId = tmpId;
      const kbAdapter = getAccessAdapter("knowledge_base");
      if (!kbAdapter) {
        bad("B1 generic checkCreate .all 修复", "knowledge_base adapter 未注册");
      } else {
        // grant kb.create.all
        await db.from("admin_permission_overrides").insert({
          admin_source: "admin_table", admin_id: tmpId, permission_key: "kb.create.all", effect: "grant",
          created_by: tmpId,
        });
        overridesToClear.push({ admin_source: "admin_table", admin_id: tmpId, permission_key: "kb.create.all" });
        const actorGrant = await buildPermissionActor({ type: "admin", adminId: tmpId, username: "smoke", role: "system_admin" } as never);
        const okCreate = await kbAdapter.checkCreate(actorGrant);
        if (okCreate === true) ok("B1 sys(no tenant)+kb.create.all → checkCreate", "true（.all 兜底生效，修复前误拒）");
        else bad("B1 sys(no tenant)+kb.create.all → checkCreate", `期望 true 实际 ${okCreate}`);

        // 撤销 → checkCreate=false
        await db.from("admin_permission_overrides").delete()
          .eq("admin_source", "admin_table").eq("admin_id", tmpId).eq("permission_key", "kb.create.all");
        overridesToClear.length = 0;
        const actorRevoke = await buildPermissionActor({ type: "admin", adminId: tmpId, username: "smoke", role: "system_admin" } as never);
        const okCreate2 = await kbAdapter.checkCreate(actorRevoke);
        if (okCreate2 === false) ok("B1' 撤销 kb.create.all → checkCreate", "false");
        else bad("B1' 撤销 kb.create.all → checkCreate", `期望 false 实际 ${okCreate2}`);
      }
    }

    // B2 · 4 个重写 adapter 的 loadDetail 对真实样本行返回非 null（不再因列不存在 404）
    const samples: Array<[string, string]> = [
      ["workflow", "workflows"],
      ["agent", "agents"],
      ["agent_draft", "agent_drafts"],
      ["user", "users"],
    ];
    for (const [kind, table] of samples) {
      const adapter = getAccessAdapter(kind);
      if (!adapter) { bad(`B2 ${kind} adapter`, "未注册"); continue; }
      const { data: row } = await db.from(table).select("id").limit(1).maybeSingle();
      if (!row) { skip(`B2 ${kind}.loadDetail`, `${table} 无样本行`); continue; }
      try {
        const detail = await adapter.loadDetail((row as { id: string }).id);
        if (detail && typeof detail === "object" && "id" in detail) {
          ok(`B2 ${kind}.loadDetail 真实行`, `非 null（不再 404）`);
        } else {
          bad(`B2 ${kind}.loadDetail 真实行`, `返回 ${JSON.stringify(detail)}`);
        }
      } catch (e) {
        bad(`B2 ${kind}.loadDetail 真实行`, `抛错: ${(e as Error).message}`);
      }
    }
  }
}

main()
  .catch((e) => { console.error("[phase-d-smoke] 异常:", e); failed++; })
  .finally(async () => {
    await cleanup();
    // 终态：overrides 残留检查
    if (tempSysAdminId) {
      const { count } = await db.from("admin_permission_overrides")
        .select("*", { count: "exact", head: true }).eq("admin_id", tempSysAdminId);
      if ((count ?? 0) > 0) { failed++; console.error(`  ⚠ 残留 override ${count} 条`); }
    }
    console.log(`\n${failed === 0 ? "✅" : "❌"} 完成：${failed} 失败 / ${skipped} 跳过`);
    process.exit(failed === 0 ? 0 : 1);
  });
