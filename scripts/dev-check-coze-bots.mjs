#!/usr/bin/env node
/**
 * dev 期工具 · 检查指定 coze provider 下所有绑定智能体能否正常对话
 *
 * 用法：
 *   node scripts/dev-check-coze-bots.mjs                 # 列出所有 platform=coze 的 provider 让你选
 *   node scripts/dev-check-coze-bots.mjs --name 前哨     # 按 name 模糊匹配 + 自动测试
 *   node scripts/dev-check-coze-bots.mjs --id <pid>      # 按 provider id 精确匹配 + 自动测试
 *
 * 行为：
 *   1) 找到 coze provider；
 *   2) decrypt provider.api_key_enc；
 *   3) 列出该 provider 名下所有 agents（platform='coze' AND provider_id=<id>）；
 *   4) 对每个 agent 调 https://api.coze.cn/v3/chat 发 "hi" 流式测试，捕获前 5s 内的事件；
 *   5) 汇总：✅ 通 / ❌ HTTP 错 / ❌ Coze 业务失败 / ⏱ 超时 / ⚠ 空响应
 *
 * 不写库、不动配置；纯只读 + 调上游验证。
 */
import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── 读 .env.local ─────────────────────────────────────────────────
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
if (!SUPABASE_URL || !SERVICE_KEY || !JWT_SECRET) {
  console.error("✗ 缺少环境变量：NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET");
  process.exit(1);
}

// ── decrypt（与 lib/crypto.ts 路径 A 一致：新 key 优先，回退旧 key）───
const DEC_NEW_KEY = (() => {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
})();
const DEC_OLD_KEY = crypto.createHash("sha256").update(JWT_SECRET).digest();
function decryptWithKey(key, p) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(p[0], "hex"));
  d.setAuthTag(Buffer.from(p[1], "hex"));
  return Buffer.concat([d.update(Buffer.from(p[2], "hex")), d.final()]).toString("utf8");
}
function decrypt(ciphertext) {
  if (!ciphertext) return "";
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext; // 历史明文兼容
  if (DEC_NEW_KEY) {
    try { return decryptWithKey(DEC_NEW_KEY, parts); } catch { /* fallthrough */ }
  }
  try { return decryptWithKey(DEC_OLD_KEY, parts); } catch { /* fallthrough */ }
  throw new Error("decrypt failed with both keys");
}

// ── 命令行参数 ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const filterName = getArg("--name");
const filterId = getArg("--id");

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// ── 1) 找 provider ───────────────────────────────────────────────
async function findProvider() {
  let q = sb.from("model_providers").select("*").eq("platform", "coze");
  if (filterId) q = q.eq("id", filterId);
  else if (filterName) q = q.ilike("name", `%${filterName}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── 2) 列 agents ─────────────────────────────────────────────────
async function listAgents(providerId) {
  const { data, error } = await sb
    .from("agents")
    .select("id, name, agent_code, enabled, model_params, tenant_code")
    .eq("provider_id", providerId)
    .eq("platform", "coze")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── 3) 调 coze 测试 ──────────────────────────────────────────────
const TEST_TIMEOUT_MS = 8000;
const TEST_MESSAGE = "hi";

async function testCozeAgent({ apiKey, endpoint, botId }) {
  const url = endpoint || "https://api.coze.cn/v3/chat";
  const body = {
    bot_id: botId,
    user_id: "dev_healthcheck",
    stream: true,
    auto_save_history: false,
    additional_messages: [
      { role: "user", content: TEST_MESSAGE, content_type: "text" },
    ],
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") return { status: "timeout", detail: `> ${TEST_TIMEOUT_MS}ms` };
    return { status: "neterr", detail: String(e.message || e) };
  }

  if (!res.ok) {
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    return { status: "http_err", detail: `${res.status} ${text.slice(0, 200)}` };
  }

  // 解析 SSE，看是否有 message.delta 或 chat.failed
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawDelta = false;
  let failMsg = null;
  let sample = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // SSE 以 "\n\n" 分包
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evt = null;
        let data = null;
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith("event:")) evt = line.slice(6).trim();
          else if (line.startsWith("data:")) data = (data ?? "") + line.slice(5).trim();
        }
        if (!data) continue;
        let obj = null;
        try { obj = JSON.parse(data); } catch { continue; }
        const eType = evt || obj.event;
        if (eType === "conversation.chat.failed") {
          failMsg = obj.last_error?.msg ?? JSON.stringify(obj).slice(0, 200);
          break;
        }
        if (eType === "conversation.message.delta") {
          sawDelta = true;
          const piece = obj.content ?? obj.data?.content ?? "";
          if (sample.length < 80 && piece) sample += piece;
          // 拿到一段就行，提前结束
          if (sample.length >= 20) break;
        }
      }
      if (sawDelta && sample.length >= 20) break;
      if (failMsg) break;
    }
  } finally {
    clearTimeout(timer);
    try { reader.cancel(); } catch { /* ignore */ }
  }

  if (failMsg) return { status: "coze_fail", detail: failMsg };
  if (sawDelta) return { status: "ok", detail: sample.replace(/\s+/g, " ").slice(0, 60) };
  return { status: "empty", detail: "上游返回 200 但无 delta 事件" };
}

// ── 主流程 ───────────────────────────────────────────────────────
(async () => {
  const providers = await findProvider();
  if (providers.length === 0) {
    console.error("✗ 没找到匹配的 coze provider（filter:", filterName || filterId || "(none)", "）");
    process.exit(1);
  }
  if (providers.length > 1 && !filterId) {
    console.log("找到多个 coze provider，请用 --id <pid> 精确指定：");
    for (const p of providers) {
      console.log(`  [${p.id}] ${p.name}  (code=${p.provider_code}, enabled=${p.enabled})`);
    }
    process.exit(0);
  }

  const p = providers[0];
  console.log(`\n=== Provider ===`);
  console.log(`  name      : ${p.name}`);
  console.log(`  id        : ${p.id}`);
  console.log(`  code      : ${p.provider_code}`);
  console.log(`  endpoint  : ${p.api_endpoint || "(默认 https://api.coze.cn/v3/chat)"}`);
  console.log(`  enabled   : ${p.enabled}`);
  console.log(`  has_key   : ${Boolean(p.api_key_enc)}`);

  if (!p.enabled) {
    console.log("\n⚠ provider 已禁用，仍继续测试上游 key 与各 bot 的连通性。");
  }

  let apiKey;
  try {
    apiKey = decrypt(p.api_key_enc);
  } catch (e) {
    console.error(`\n✗ provider key 解密失败：${e.message}`);
    console.error("  → 去 API 管理「清空 Key」+ 重新粘正确的 key 后再跑。");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("\n✗ provider key 解密为空");
    process.exit(1);
  }

  const agents = await listAgents(p.id);
  console.log(`\n=== Agents bound to this provider (${agents.length}) ===\n`);
  if (agents.length === 0) {
    console.log("  (无)");
    process.exit(0);
  }

  const rows = [];
  for (const a of agents) {
    const botId = a.model_params?.bot_id ?? a.agent_code;
    process.stdout.write(`  testing ${a.name} (bot=${botId})… `);
    const r = await testCozeAgent({
      apiKey,
      endpoint: p.api_endpoint,
      botId,
    });
    const icon = {
      ok:        "✅",
      http_err:  "❌",
      coze_fail: "❌",
      neterr:    "🌐",
      timeout:   "⏱ ",
      empty:     "⚠ ",
    }[r.status] ?? "?";
    console.log(`${icon} ${r.status}  ${r.detail}`);
    rows.push({
      name: a.name,
      bot_id: botId,
      enabled: a.enabled,
      tenant: a.tenant_code || "(personal)",
      status: r.status,
      detail: r.detail,
    });
  }

  // 汇总
  console.log("\n=== Summary ===");
  const ok = rows.filter((r) => r.status === "ok").length;
  const fail = rows.length - ok;
  console.log(`  ✅ 通: ${ok} / ${rows.length}    ❌/⏱/⚠ 异常: ${fail}`);
  if (fail > 0) {
    console.log("\n  失败列表：");
    for (const r of rows.filter((r) => r.status !== "ok")) {
      console.log(`    - ${r.name} [${r.status}] ${r.detail}`);
    }
  }
})().catch((e) => {
  console.error("\n✗ 脚本异常：", e);
  process.exit(1);
});
