/**
 * 6.4up v2 Phase C 启动前 dev 残留检查（只读）
 *
 * 用户拍板 R12 应对 C(a)：开 enforce 前先看 builtin_role_permissions / admin_permission_overrides 是否被 Phase B 测试改过。
 *
 * 查询：
 *   1. builtin_role_permissions count by role（期望 system_admin=109, org_admin=64）
 *   2. admin_permission_overrides 总条数 + 前 20 行 detail（期望空集）
 *
 * 输出：报告 + 是否需要清理的建议。
 * 用法：tsx scripts/check-phase-c-pre.ts
 *      或 npm run check:phase-c-pre（package.json 里我没加 script；本次手跑即可）
 *
 * 安全：纯 SELECT，不改任何数据。
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

// 手工读 .env.local，避免引 next/dotenv 依赖
function loadEnvLocal(): Record<string, string> {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return {};
  const txt = fs.readFileSync(p, "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[check-phase-c-pre] 缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log(`[check-phase-c-pre] target: ${url}`);

  // 1. builtin_role_permissions 分 role count + diff vs seed 预期
  const [system, org] = await Promise.all([
    db.from("builtin_role_permissions").select("permission_key", { count: "exact", head: false }).eq("role", "system_admin"),
    db.from("builtin_role_permissions").select("permission_key", { count: "exact", head: false }).eq("role", "org_admin"),
  ]);
  if (system.error || org.error) {
    console.error("[check-phase-c-pre] builtin_role_permissions 查询失败：", system.error?.message ?? org.error?.message);
    process.exit(1);
  }
  const systemKeys = ((system.data ?? []) as { permission_key: string }[]).map((r) => r.permission_key).sort();
  const orgKeys = ((org.data ?? []) as { permission_key: string }[]).map((r) => r.permission_key).sort();

  console.log("\n— builtin_role_permissions —");
  console.log(`  system_admin: ${systemKeys.length} keys (v52 seed 期望 109)`);
  console.log(`  org_admin:    ${orgKeys.length} keys (v52 seed 期望 64)`);

  let dirty = false;
  if (systemKeys.length !== 109) {
    console.log(`  ⚠ system_admin 数不等于 109，可能被 Phase B Tab 2 改过`);
    dirty = true;
  }
  if (orgKeys.length !== 64) {
    console.log(`  ⚠ org_admin 数不等于 64，可能被 Phase B Tab 2 改过`);
    dirty = true;
  }

  // 2. admin_permission_overrides
  const ovs = await db
    .from("admin_permission_overrides")
    .select("admin_source, admin_id, permission_key, effect, reason, created_at", { count: "exact" });
  if (ovs.error) {
    console.error("[check-phase-c-pre] admin_permission_overrides 查询失败：", ovs.error.message);
    process.exit(1);
  }
  type Ov = {
    admin_source: string;
    admin_id: string;
    permission_key: string;
    effect: string;
    reason: string | null;
    created_at: string;
  };
  const ovsList = (ovs.data ?? []) as Ov[];
  console.log("\n— admin_permission_overrides —");
  console.log(`  total: ${ovs.count ?? ovsList.length}`);
  if (ovsList.length > 0) {
    console.log(`  前 20 行：`);
    for (const o of ovsList.slice(0, 20)) {
      console.log(
        `    ${o.effect.padEnd(7)} ${o.admin_source.padEnd(11)} ${o.admin_id.slice(0, 8)}… ${o.permission_key}` +
          (o.reason ? `  reason="${o.reason}"` : ""),
      );
    }
    dirty = true;
  }

  console.log("\n— 结论 —");
  if (dirty) {
    console.log("  ⚠ dev 两表存在 Phase B 测试残留。开 enforce 前建议清理：");
    console.log("    -- 仅供参考的清理 SQL（手动跑前再确认目标范围）");
    console.log("    DELETE FROM admin_permission_overrides;");
    console.log("    -- 默认包恢复：用 supabase/migration_v52_permission_v2.sql 第 50-172 行");
    console.log("    --             和第 178-254 行重跑两段 INSERT");
    console.log("    -- 或：在 Tab 2 手工调整回 109 / 64 后保存");
  } else {
    console.log("  ✅ dev 两表与 v52 seed 一致 + 无 override，可直接开 enforce 联调");
  }
}

main().catch((e) => {
  console.error("[check-phase-c-pre] uncaught:", e);
  process.exit(1);
});
