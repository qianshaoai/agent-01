// dev 工具：把 PR-C 发布出来但默认 enabled=false 的 agent 批量启用
//
// 用法：
//   node scripts/dev-enable-published-drafts.mjs
//
// 行为：
//   找所有 published_from_draft_id IS NOT NULL 且 enabled=false 的 agent
//   全部改成 enabled=true
//   仅在 PR-D 完成（chat / greeting 链路兼容 provider_id）后跑，
//   提前跑会让用户聊不通新 agent（chat route 找不到 key）。

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");

if (!existsSync(envPath)) {
  console.error("找不到 .env.local，请在项目根目录跑");
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

const sb = createClient(url, key, { auth: { persistSession: false } });

// 1) 列出候选
const { data: candidates, error: listErr } = await sb
  .from("agents")
  .select("id, agent_code, name, enabled, provider_id, published_from_draft_id")
  .not("published_from_draft_id", "is", null)
  .eq("enabled", false);

if (listErr) {
  console.error("查询失败：", listErr.message);
  process.exit(1);
}

if (!candidates?.length) {
  console.log("没有需要启用的 agent（所有 published_from_draft_id 非空的 agent 都已 enabled=true）");
  process.exit(0);
}

console.log(`找到 ${candidates.length} 个待启用 agent：`);
candidates.forEach((a) => console.log(`  - ${a.agent_code}  ${a.name}  (provider=${a.provider_id?.slice(0, 8) ?? "无"})`));

// 2) 批量更新
const ids = candidates.map((a) => a.id);
const { error: updErr } = await sb
  .from("agents")
  .update({ enabled: true })
  .in("id", ids);

if (updErr) {
  console.error("批量启用失败：", updErr.message);
  process.exit(1);
}

console.log(`\n✓ 已启用 ${ids.length} 个 agent，员工现在可以从用户端访问`);
