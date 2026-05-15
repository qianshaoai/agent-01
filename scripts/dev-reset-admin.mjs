// dev 工具：把 admin 账号重置回 admin / admin
//
// 用法：
//   node scripts/dev-reset-admin.mjs
//
// 行为：
//   1. 读 .env.local 拿 Supabase 配置
//   2. 把 admins.pwd_hash 改回 bcrypt("admin", 10) 的固定 hash
//   3. 清掉 force_relogin_at（避免新登录 token 立刻被踢）
//
// 仅限 dev 环境用——这个脚本绕过任何 admin auth，prod 不要跑。

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

if (!existsSync(envPath)) {
  console.error("找不到 .env.local，请确认在项目根目录跑");
  process.exit(1);
}

const env = readFileSync(envPath, "utf-8");
const get = (k) => {
  const line = env.split("\n").find((l) => l.startsWith(k + "="));
  return line?.split("=").slice(1).join("=").trim();
};

const url = get("NEXT_PUBLIC_SUPABASE_URL");
const key = get("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// bcrypt("admin", 10) 的固定 hash —— schema.sql 里的种子值，已知能 match "admin"
const ADMIN_HASH = "$2b$10$QeyfJGSEt9nzm4Na13uNqeg1T7lCNRASH46eQSw87iNF/YJCftf62";

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await sb
  .from("admins")
  .update({ pwd_hash: ADMIN_HASH, force_relogin_at: null })
  .eq("username", "admin")
  .select("username, role")
  .maybeSingle();

if (error) {
  console.error("UPDATE 失败：", error.message);
  process.exit(1);
}

if (!data) {
  // admin 行不存在 → 重新创建
  console.log("admins.admin 不存在，重新插入...");
  const { error: insErr } = await sb
    .from("admins")
    .insert({ username: "admin", pwd_hash: ADMIN_HASH, role: "super_admin" });
  if (insErr) {
    console.error("INSERT 失败：", insErr.message);
    process.exit(1);
  }
  console.log("✓ 已创建 admin / admin (role=super_admin)");
} else {
  console.log(`✓ 已重置 admin 密码（role=${data.role ?? "super_admin"}），现在可以用 admin / admin 登录`);
}
