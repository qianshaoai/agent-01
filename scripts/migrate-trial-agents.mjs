/**
 * 一次性脚本 · 体验版 3 智能体迁入正式版 agents 表
 *
 * 用法（项目根目录）：
 *   node --env-file=.env.local scripts/migrate-trial-agents.mjs
 *
 * 必需环境变量：
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JWT_SECRET                     # 用于 AES-256-GCM 加密 api_key
 *   TRIAL_AGENT_001_BOT_ID         # Coze 测试对话智能体 bot id
 *   TRIAL_AGENT_001_API_TOKEN      # Coze 测试对话智能体 token
 *   TRIAL_AGENT_002_BOT_ID         # Coze 前哨知识库 bot id
 *   TRIAL_AGENT_002_API_TOKEN      # Coze 前哨知识库 token
 *   TRIAL_AGENT_003_ASSISTANT_ID   # Yuanqi 测试智能体2 assistant id
 *   TRIAL_AGENT_003_API_KEY        # Yuanqi 测试智能体2 app key
 *
 * 行为：两阶段写入（避免 upsert 误覆盖手动改过的展示类型 / 外链 / 启停 / 分类）：
 *   1. SELECT 现有 agent_code → 分成"已存在 / 不存在"两组
 *   2. 不存在 → INSERT 全列（agent_type='chat'、external_url=''、其它默认值由表负责）
 *   3. 已存在 → UPDATE 仅 6 列：name / description / platform /
 *      api_endpoint / api_key_enc / model_params；
 *      不动 agent_type / external_url / enabled / category_id
 */

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ── 内联 lib/crypto.ts 的 encrypt（避免依赖 TS 运行时） ──────────────────
const ALG = "aes-256-gcm";
function getKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET 未设置");
  return createHash("sha256").update(secret).digest();
}
function encrypt(plaintext) {
  if (!plaintext) return "";
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── env 校验 ────────────────────────────────────────────────────────────
const REQUIRED_ENVS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "TRIAL_AGENT_001_BOT_ID",
  "TRIAL_AGENT_001_API_TOKEN",
  "TRIAL_AGENT_002_BOT_ID",
  "TRIAL_AGENT_002_API_TOKEN",
  "TRIAL_AGENT_003_ASSISTANT_ID",
  "TRIAL_AGENT_003_API_KEY",
];

const missing = REQUIRED_ENVS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("❌ 缺少必需环境变量:");
  for (const k of missing) console.error("   -", k);
  console.error("\n提示：使用 `node --env-file=.env.local scripts/migrate-trial-agents.mjs`");
  process.exit(1);
}

// ── 待迁入数据：6 列共用 + 仅插入时使用的 2 列 ─────────────────────────
// updateCols 是 UPDATE 时会写的字段（INSERT 时也写）
// insertOnlyCols 是仅 INSERT 时写的字段（UPDATE 时不动）
const rows = [
  {
    updateCols: {
      agent_code: "AGT-COZE-001",
      name: "测试对话智能体",
      description: "用于测试智能体问答能力",
      platform: "coze",
      api_endpoint: "https://api.coze.cn/v3/chat",
      api_key_enc: encrypt(process.env.TRIAL_AGENT_001_API_TOKEN),
      model_params: { bot_id: process.env.TRIAL_AGENT_001_BOT_ID },
    },
    insertOnlyCols: { agent_type: "chat", external_url: "" },
  },
  {
    updateCols: {
      agent_code: "AGT-COZE-002",
      name: "前哨-知识库入库整理",
      description: "辅助梳理与整理知识库入库内容",
      platform: "coze",
      api_endpoint: "https://api.coze.cn/v3/chat",
      api_key_enc: encrypt(process.env.TRIAL_AGENT_002_API_TOKEN),
      model_params: { bot_id: process.env.TRIAL_AGENT_002_BOT_ID },
    },
    insertOnlyCols: { agent_type: "chat", external_url: "" },
  },
  {
    updateCols: {
      agent_code: "AGT-YUANQI-001",
      name: "测试对话智能体2",
      description: "用于测试元器（腾讯）智能体问答能力",
      platform: "yuanqi",
      api_endpoint: "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions",
      api_key_enc: encrypt(process.env.TRIAL_AGENT_003_API_KEY),
      model_params: { assistant_id: process.env.TRIAL_AGENT_003_ASSISTANT_ID },
    },
    insertOnlyCols: { agent_type: "chat", external_url: "" },
  },
];

// ── 两阶段写入 ─────────────────────────────────────────────────────────
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log("🚀 开始迁入 3 条 agent…");
console.log("   目标 supabase:", process.env.NEXT_PUBLIC_SUPABASE_URL);

// 1) 查询哪些 agent_code 已存在
const codes = rows.map((r) => r.updateCols.agent_code);
const { data: existingRows, error: selErr } = await sb
  .from("agents")
  .select("agent_code")
  .in("agent_code", codes);

if (selErr) {
  console.error("❌ 查询现有 agent 失败:", selErr);
  process.exit(1);
}

const existingCodes = new Set((existingRows ?? []).map((r) => r.agent_code));

// 2) 不存在 → INSERT 全列（updateCols + insertOnlyCols）
const toInsert = rows.filter((r) => !existingCodes.has(r.updateCols.agent_code));
if (toInsert.length > 0) {
  const insertPayload = toInsert.map((r) => ({ ...r.updateCols, ...r.insertOnlyCols }));
  const { error: insErr } = await sb.from("agents").insert(insertPayload);
  if (insErr) {
    console.error("❌ INSERT 失败:", insErr);
    process.exit(1);
  }
  console.log(`   ➕ 新建 ${toInsert.length} 条:`, toInsert.map((r) => r.updateCols.agent_code).join(", "));
}

// 3) 已存在 → UPDATE 仅 updateCols 6 列（agent_code 当 WHERE，不重写自身）
const toUpdate = rows.filter((r) => existingCodes.has(r.updateCols.agent_code));
for (const r of toUpdate) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { agent_code, ...patch } = r.updateCols;
  const { error: updErr } = await sb
    .from("agents")
    .update(patch)
    .eq("agent_code", r.updateCols.agent_code);
  if (updErr) {
    console.error(`❌ UPDATE ${r.updateCols.agent_code} 失败:`, updErr);
    process.exit(1);
  }
}
if (toUpdate.length > 0) {
  console.log(`   ♻️  更新 ${toUpdate.length} 条:`, toUpdate.map((r) => r.updateCols.agent_code).join(", "));
}

// 4) 回查验证
const { data, error } = await sb
  .from("agents")
  .select("id, agent_code, name, platform, agent_type, external_url, enabled, category_id")
  .in("agent_code", codes)
  .order("agent_code", { ascending: true });

if (error) {
  console.error("❌ 回查失败:", error);
  process.exit(1);
}

console.log("\n✅ 迁入完成，共", data.length, "条:");
console.table(
  data.map((d) => ({
    id: d.id,
    agent_code: d.agent_code,
    name: d.name,
    platform: d.platform,
    agent_type: d.agent_type,
    enabled: d.enabled,
    category_id: d.category_id ?? "(空)",
  }))
);

// ── 末尾打印 SQL 验证语句，方便去 Supabase Studio 复核 ──────────────────
console.log("\n📋 复核 SQL（复制到 Supabase Studio 执行）:");
console.log(
  "SELECT id, agent_code, name, platform, agent_type, enabled, category_id, " +
    "api_endpoint, model_params, length(api_key_enc) AS key_len, created_at\n" +
    "  FROM agents\n" +
    " WHERE agent_code IN ('AGT-COZE-001', 'AGT-COZE-002', 'AGT-YUANQI-001')\n" +
    " ORDER BY agent_code;"
);

console.log("\n👉 下一步：");
console.log("   1. 进 /admin/agents 确认 3 条记录可见");
console.log("   2. 在 /admin/workflows 把这 3 条按需绑到 workflow 的 step 上");
console.log("   3. 主页选中对应 workflow → 智能体卡 → 发消息验证");
