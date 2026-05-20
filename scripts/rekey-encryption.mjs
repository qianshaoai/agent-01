#!/usr/bin/env node
/**
 * 5.16up · 加密 key 拆分收口 · 存量 rekey
 * 把 *_enc 列的密文从旧 key（sha256(JWT_SECRET)）整体重写为新 key（ENCRYPTION_KEY）。
 * 方案：upgrade/5.16up/加密key拆分收口-rekey方案-20260518.md
 *
 * 用法（在 prod 同环境跑，ENCRYPTION_KEY + JWT_SECRET 须都在）：
 *   node scripts/rekey-encryption.mjs                     # dry-run（默认，不写库）
 *   node scripts/rekey-encryption.mjs --apply             # 实写
 *   node scripts/rekey-encryption.mjs --new-key-env NAME  # 改新 key 来源变量名（默认 ENCRYPTION_KEY）
 *
 * 安全要点（方案 §四 + 小B 评审）：
 *  - 新 key 只从环境变量读，绝不接受命令行传值（argv 会进 shell history / ps）。
 *  - 自带 encrypt/decrypt，不 import lib/crypto.ts —— 避免误用其 dev fallback。
 *  - 新 key base64 解码必须正好 32 字节；新旧 key 相等即 abort（伪拆分）。
 *  - 写库前回环自校验 decrypt(新密文)===原文 才 update。
 *  - plaintext_shape / failed / verify_failed / update_failed > 0 → 退出码非 0。
 *  - 不打印任何明文 key。
 */
import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ── 读 .env.local（与其它脚本一致；node --env-file 也兼容）──────────
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function abort(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── 参数 ────────────────────────────────────────────────────────
const APPLY = process.argv.includes("--apply");
const keyEnvIdx = process.argv.indexOf("--new-key-env");
const NEW_KEY_VAR = keyEnvIdx >= 0 ? process.argv[keyEnvIdx + 1] : "ENCRYPTION_KEY";
if (!NEW_KEY_VAR) abort("--new-key-env 后面要跟变量名");

// ── 环境变量 ────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const NEW_KEY_RAW = process.env[NEW_KEY_VAR];

if (!SUPABASE_URL || !SERVICE_KEY) abort("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (!JWT_SECRET) abort("缺少 JWT_SECRET（旧 key 来源）");
if (!NEW_KEY_RAW) abort(`缺少环境变量 ${NEW_KEY_VAR}（新 key 来源）—— 本脚本不接受命令行传 key`);

// ── 新旧 key ────────────────────────────────────────────────────
const ALG = "aes-256-gcm";
const NEW_KEY = Buffer.from(NEW_KEY_RAW, "base64");
if (NEW_KEY.length !== 32) {
  abort(`${NEW_KEY_VAR} base64 解码后必须是 32 字节，实际 ${NEW_KEY.length} —— 检查是否配错`);
}
const OLD_KEY = crypto.createHash("sha256").update(JWT_SECRET).digest();

// 小B 评审：新旧 key 相等 = 伪拆分（如 ENCRYPTION_KEY 误配成 base64(sha256(JWT_SECRET))）。
// 这种情况下旧密文会被「新 key」直接解开、统计全落 new_hit，但安全上等于没拆分。
if (NEW_KEY.equals(OLD_KEY)) {
  abort(
    `${NEW_KEY_VAR} 派生出的新 key 与 sha256(JWT_SECRET) 旧 key 完全相等 —— 这是“伪拆分”，\n` +
      "  rekey 跑完安全上等于没拆。请把 ENCRYPTION_KEY 换成一个与 JWT_SECRET 无关的独立随机值。",
  );
}

// ── 自带加解密（不 import lib/crypto.ts，避免误用其 dev fallback）──
function encryptNew(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, NEW_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}
function decryptWith(key, parts) {
  const d = crypto.createDecipheriv(ALG, key, Buffer.from(parts[0], "hex"));
  d.setAuthTag(Buffer.from(parts[1], "hex"));
  return Buffer.concat([d.update(Buffer.from(parts[2], "hex")), d.final()]).toString("utf8");
}
function classifyError(kind) {
  const e = new Error(kind);
  e.kind = kind;
  return e;
}
// → { plain, hitBy: "new"|"old" }；失败抛 Error.kind = "plaintext_shape" | "failed"
function decryptClassify(cipher) {
  const parts = cipher.split(":");
  if (parts.length !== 3) throw classifyError("plaintext_shape");
  try {
    return { plain: decryptWith(NEW_KEY, parts), hitBy: "new" };
  } catch { /* 新 key 解不开，试旧 key */ }
  try {
    return { plain: decryptWith(OLD_KEY, parts), hitBy: "old" };
  } catch {
    throw classifyError("failed");
  }
}

// ── 收口范围（4 表，主键均为 id）────────────────────────────────
const TARGETS = [
  { table: "agents", col: "api_key_enc" },
  { table: "model_providers", col: "api_key_enc" },
  { table: "user_agents", col: "api_key_enc" },
  { table: "tenants", col: "openai_key_enc" },
];

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function fetchAll(table, col) {
  const PAGE = 1000;
  const all = [];
  let from = 0;
  let batch;
  do {
    const { data, error } = await db
      .from(table)
      .select(`id, ${col}`)
      .order("id", { ascending: true }) // 分页稳定排序，防漏扫 / 重复扫
      .range(from, from + PAGE - 1);
    if (error) return { error };
    batch = data ?? [];
    all.push(...batch);
    from += PAGE;
  } while (batch.length === PAGE);
  return { data: all };
}

console.log(`\n=== rekey-encryption · ${APPLY ? "APPLY（实写）" : "dry-run（不写库）"} ===`);
console.log(`新 key 来源变量：${NEW_KEY_VAR}\n`);

let problemTotal = 0;

for (const { table, col } of TARGETS) {
  const { data: rows, error } = await fetchAll(table, col);
  if (error) abort(`查询 ${table}.${col} 失败：${error.message}`);

  const c = { empty: 0, new_hit: 0, old_hit: 0, plaintext_shape: 0, failed: 0, rewritten: 0 };
  const probs = {
    plaintext_shape: [], failed: [], verify_failed: [], update_failed: [], concurrent_changed: [],
  };

  for (const row of rows) {
    const cipher = row[col];
    if (!cipher) { c.empty++; continue; }

    let res;
    try {
      res = decryptClassify(cipher);
    } catch (e) {
      if (e.kind === "plaintext_shape") { c.plaintext_shape++; probs.plaintext_shape.push(row.id); }
      else { c.failed++; probs.failed.push(row.id); }
      continue;
    }
    if (res.hitBy === "new") c.new_hit++;
    else c.old_hit++;

    // 重写为新 key 密文 + 回环自校验：新密文必须能被新 key 解回原文
    const newCipher = encryptNew(res.plain);
    let verified = false;
    try {
      const back = decryptClassify(newCipher);
      verified = back.hitBy === "new" && back.plain === res.plain;
    } catch { verified = false; }
    if (!verified) { probs.verify_failed.push(row.id); continue; }

    if (APPLY) {
      // CAS：仅当该行密文仍等于读取时的值才写 —— 防 rekey 读取后管理员并发改 key 被覆盖
      const { data: updated, error: uErr } = await db
        .from(table)
        .update({ [col]: newCipher })
        .eq("id", row.id)
        .eq(col, cipher)
        .select("id");
      if (uErr) { probs.update_failed.push(row.id); continue; }
      if (!updated || updated.length === 0) { probs.concurrent_changed.push(row.id); continue; }
      c.rewritten++;
    }
  }

  console.log(`── ${table}.${col} ──`);
  console.log(
    `   empty=${c.empty}  new_hit=${c.new_hit}  old_hit=${c.old_hit}  ` +
      `plaintext_shape=${c.plaintext_shape}  failed=${c.failed}` +
      (APPLY ? `  rewritten=${c.rewritten}` : ""),
  );
  for (const [kind, ids] of Object.entries(probs)) {
    if (ids.length) {
      const note = kind === "concurrent_changed"
        ? "读取后被并发改动，未覆盖；重跑本脚本即可确认"
        : "需人工处理";
      console.log(`   ⚠ ${kind}（${note}）：${ids.join(", ")}`);
      problemTotal += ids.length;
    }
  }
  console.log("");
}

if (problemTotal > 0) {
  console.error(
    `✗ 共 ${problemTotal} 行未确认收口（见上方分类）。` +
      "concurrent_changed 重跑本脚本即可确认；其余需人工处理。",
  );
  process.exit(1);
}
console.log(
  APPLY
    ? "✓ rekey 完成：所有密文已重写为新 key，无问题行。"
    : "✓ dry-run 通过：无问题行。确认无误后加 --apply 实写。",
);
console.log("  验收：--apply 后再跑一次 dry-run，应 old_hit=0、全部落 new_hit。\n");
