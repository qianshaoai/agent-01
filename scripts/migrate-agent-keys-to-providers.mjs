#!/usr/bin/env node
/**
 * 5.15up · API 管理模块 PR-3
 * 把现存正式智能体（agents 表）自带的 api_key_enc 归拢成命名 API（model_providers），
 * 并回填 agents.provider_id。
 *
 * 用法：
 *   node scripts/migrate-agent-keys-to-providers.mjs            # dry-run（默认，只预览不写）
 *   node scripts/migrate-agent-keys-to-providers.mjs --apply    # 正式执行
 *
 * 设计要点（方案 §六 + 小B 评审）：
 *  - 不能按 api_key_enc 密文分组（AES-GCM 随机 IV，同 key 密文每次不同）。
 *    逐条解密 → 算 HMAC-SHA256 fingerprint → 按 fingerprint 分组。
 *  - 分组维度：category + platform + 有效 endpoint + key fingerprint。
 *    bot_id / assistant_id / model 等留在 agent.model_params 里，不进分组、不丢。
 *  - 幂等：provider_code 稳定（migrated-{cat}-{platform}-{endpointHash6}-{fp8}）；
 *    已存在则复用；已回填 provider_id 的 agent 不重复处理。
 *  - provider_code 已存在但内容不一致 → 视为冲突，中止、不写入、要求人工确认。
 *  - 只新增 model_providers + 回填 provider_id，**不删 api_key_enc**（过渡期保留）。
 *  - 日志不输出明文 key / 完整 fingerprint。
 */
import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── 读 .env.local ───────────────────────────────────────────────
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const APPLY = process.argv.includes("--apply");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
if (!SUPABASE_URL || !SERVICE_KEY || !JWT_SECRET) {
  console.error("✗ 缺少环境变量：NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET");
  process.exit(1);
}
// fingerprint 用的 secret：固定值即可（同环境多次运行须一致），默认从 JWT_SECRET 派生
const FP_SECRET = process.env.MIGRATION_FINGERPRINT_SECRET || "mig-fp:" + JWT_SECRET;

// ── 与 lib/crypto.ts 一致的解密（AES-256-GCM，key = sha256(JWT_SECRET)）──
function decrypt(ct) {
  if (!ct) return "";
  const p = ct.split(":");
  if (p.length !== 3) return ct; // 旧明文数据，原样返回
  const key = crypto.createHash("sha256").update(JWT_SECRET).digest();
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(p[0], "hex"));
  d.setAuthTag(Buffer.from(p[1], "hex"));
  return Buffer.concat([d.update(Buffer.from(p[2], "hex")), d.final()]).toString("utf8");
}
const fingerprint = (plain) => crypto.createHmac("sha256", FP_SECRET).update(plain).digest("hex");

// ── 平台 → category / 默认 endpoint ─────────────────────────────
const AGENT_PLATFORMS = ["coze", "dify", "yuanqi", "qingyan"];
const catOf = (p) => (AGENT_PLATFORMS.includes(p) ? "agent" : "model");
const DEFAULT_ENDPOINT = {
  openai: "https://api.openai.com/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  coze: "https://api.coze.cn/v3/chat",
  dify: "https://api.dify.ai/v1/chat-messages",
  yuanqi: "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions",
  qingyan: "https://chatglm.cn/chatglm/assistant-api/v1",
};
const PLATFORM_LABEL = {
  openai: "OpenAI", zhipu: "智谱 GLM", coze: "扣子 Coze",
  dify: "Dify", yuanqi: "腾讯元器", qingyan: "智谱清言",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const host = (() => { try { return new URL(SUPABASE_URL).host; } catch { return SUPABASE_URL; } })();
  console.log(`\n=== agent key → 命名 API 迁移 [${APPLY ? "APPLY · 正式执行" : "DRY-RUN · 仅预览"}] ===`);
  console.log(`目标库：${host}\n`);

  // 1) 拉所有 agent
  const { data: agents, error } = await db
    .from("agents")
    .select("id, agent_code, name, platform, api_endpoint, api_key_enc, provider_id");
  if (error) { console.error("✗ 加载 agents 失败:", error.message); process.exit(1); }

  // 2) 分类：跳过 / 问题 / 待迁移
  const skipAlready = [], skipNoKey = [], problems = [], toMigrate = [];
  for (const a of agents) {
    if (a.provider_id) { skipAlready.push(a); continue; }
    if (!a.api_key_enc) { skipNoKey.push(a); continue; }
    let plain;
    try { plain = decrypt(a.api_key_enc); } catch { problems.push({ a, why: "api_key 解密失败" }); continue; }
    if (!plain) { problems.push({ a, why: "api_key 解密为空" }); continue; }
    const endpoint = (a.api_endpoint && a.api_endpoint.trim()) || DEFAULT_ENDPOINT[a.platform] || "";
    if (!endpoint) { problems.push({ a, why: `平台 ${a.platform} 无默认 endpoint 且 agent 未填` }); continue; }
    toMigrate.push({ a, platform: a.platform, endpoint, category: catOf(a.platform), fp: fingerprint(plain), cipher: a.api_key_enc });
  }

  // 3) 分组
  const groups = new Map();
  for (const it of toMigrate) {
    const k = `${it.category}|${it.platform}|${it.endpoint}|${it.fp}`;
    if (!groups.has(k)) groups.set(k, { platform: it.platform, endpoint: it.endpoint, category: it.category, fp: it.fp, cipher: it.cipher, agents: [] });
    groups.get(k).agents.push(it.a);
  }

  // 4) 每组定 provider_code，查重 + 冲突检测
  const conflicts = [], plan = [];
  for (const g of groups.values()) {
    const endpointHash = crypto.createHash("sha256").update(g.endpoint).digest("hex").slice(0, 6);
    const providerCode = `migrated-${g.category}-${g.platform}-${endpointHash}-${g.fp.slice(0, 8)}`;
    const name = `[迁移] ${PLATFORM_LABEL[g.platform] ?? g.platform}（${g.fp.slice(0, 6)}）`;
    const { data: ex } = await db
      .from("model_providers")
      .select("id, platform, category, api_endpoint, api_key_enc")
      .eq("provider_code", providerCode)
      .maybeSingle();
    if (ex) {
      let same = ex.platform === g.platform && ex.category === g.category && ex.api_endpoint === g.endpoint;
      if (same) { try { same = fingerprint(decrypt(ex.api_key_enc)) === g.fp; } catch { same = false; } }
      if (!same) { conflicts.push(providerCode); continue; }
      plan.push({ g, providerCode, name, action: "reuse", existingId: ex.id });
    } else {
      plan.push({ g, providerCode, name, action: "create", existingId: null });
    }
  }

  // 5) 报告
  console.log(`agents 总数 ${agents.length}：`);
  console.log(`  · 已有 provider_id，跳过      ${skipAlready.length}`);
  console.log(`  · 无 api_key_enc，跳过        ${skipNoKey.length}`);
  console.log(`  · 问题，跳过                  ${problems.length}`);
  for (const p of problems) console.log(`      - ${p.a.agent_code} ${p.a.name}：${p.why}`);
  console.log(`  · 待迁移                      ${toMigrate.length}`);
  console.log(`\n归并为 ${groups.size} 条命名 API（新建 ${plan.filter(p => p.action === "create").length} / 复用 ${plan.filter(p => p.action === "reuse").length}）：`);
  for (const p of plan) {
    console.log(`  [${p.action === "create" ? "新建" : "复用"}] ${p.providerCode}`);
    console.log(`     名称=${p.name}  平台=${p.g.platform}  endpoint=${p.g.endpoint}`);
    console.log(`     覆盖 ${p.g.agents.length} 个 agent：${p.g.agents.map((a) => a.agent_code).join(", ")}`);
  }

  if (conflicts.length) {
    console.log(`\n⚠ ${conflicts.length} 组冲突：provider_code 已存在但内容不一致，需人工排查：`);
    for (const c of conflicts) console.log(`   - ${c}`);
    console.log("\n✗ 已中止，未做任何写入。");
    process.exit(2);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] 以上为预览，未写入任何数据。确认无误后加 --apply 正式执行。\n`);
    return;
  }

  // 6) APPLY：建 provider + 回填 provider_id
  let created = 0, backfilled = 0;
  for (const p of plan) {
    let providerId = p.existingId;
    if (p.action === "create") {
      const { data: ins, error: insErr } = await db
        .from("model_providers")
        .insert({
          provider_code: p.providerCode,
          name: p.name,
          platform: p.g.platform,
          category: p.g.category,
          api_endpoint: p.g.endpoint,
          api_key_enc: p.g.cipher, // 同组同 key，直接复用其中一条密文
          default_model: "",
          default_params: {},
          enabled: true,
        })
        .select("id")
        .single();
      if (insErr) { console.error(`✗ 新建 provider ${p.providerCode} 失败:`, insErr.message); process.exit(1); }
      providerId = ins.id;
      created++;
    }
    // 回填：只填 provider_id 仍为空的（幂等，重跑不覆盖）
    for (const a of p.g.agents) {
      const { data: upd, error: updErr } = await db
        .from("agents")
        .update({ provider_id: providerId })
        .eq("id", a.id)
        .is("provider_id", null)
        .select("id");
      if (updErr) { console.error(`✗ 回填 ${a.agent_code} 失败:`, updErr.message); process.exit(1); }
      backfilled += (upd?.length ?? 0);
    }
  }
  console.log(`\n✓ 完成：新建命名 API ${created} 条，回填 agent.provider_id ${backfilled} 个。`);
  console.log(`  api_key_enc 未删除（过渡期保留，PR-4 / 下个版本再清）。\n`);
}

main().catch((e) => { console.error("✗ 迁移异常:", e); process.exit(1); });
