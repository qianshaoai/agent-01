/**
 * 6.4up v2 Phase B C4 · 跨平台 seed diff 校验
 *
 * 为什么不直接写 npm script "seed:diff"：
 *   bash 进程替换 `<(...)` 在 Windows PowerShell / cmd 下不可用，npm script 跨平台跑会炸。
 *   本脚本用 Node API 自己跑 generate + 读 v52 文件 + extract 区间 + diff，跨平台 OK。
 *
 * 用法：
 *   npm run seed:check
 *   # 或 npx tsx scripts/check-permission-seed.ts
 *
 * 退出码：
 *   0 → 一致
 *   1 → 不一致（stderr 打印 diff hint）
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const V52_PATH = path.join(REPO_ROOT, "supabase", "migration_v52_permission_v2.sql");
const GEN_SCRIPT = path.join(REPO_ROOT, "scripts", "generate-permission-seed.ts");

/** 从给定文件内容中提取 INSERT INTO builtin_role_permissions ... ON CONFLICT ...; 段（可能多段） */
function extractInsertBlocks(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock && /^INSERT INTO builtin_role_permissions/.test(line)) {
      inBlock = true;
    }
    if (inBlock) {
      out.push(line);
      if (/^ON CONFLICT \(role, permission_key\) DO NOTHING;/.test(line)) {
        inBlock = false;
      }
    }
  }
  return out.join("\n");
}

function main() {
  // 1. 跑 generate-permission-seed.ts → 拿 stdout
  let generated: string;
  try {
    generated = execFileSync("npx", ["tsx", GEN_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
  } catch (e) {
    console.error("[seed-check] 跑 generate-permission-seed.ts 失败：", (e as Error).message);
    process.exit(1);
  }

  // 2. 读 v52 文件
  let v52: string;
  try {
    v52 = readFileSync(V52_PATH, "utf8");
  } catch (e) {
    console.error(`[seed-check] 读 ${V52_PATH} 失败：`, (e as Error).message);
    process.exit(1);
  }

  // 3. 提取两侧 INSERT 段
  const genBlock = extractInsertBlocks(generated).trim();
  const v52Block = extractInsertBlocks(v52).trim();

  if (genBlock.length === 0) {
    console.error("[seed-check] 脚本输出未含 INSERT INTO builtin_role_permissions 段");
    process.exit(1);
  }
  if (v52Block.length === 0) {
    console.error("[seed-check] v52 文件未含 INSERT INTO builtin_role_permissions 段");
    process.exit(1);
  }

  // 4. 对比
  if (genBlock === v52Block) {
    console.log("[seed-check] OK · generate-permission-seed.ts 输出与 v52 INSERT 段一致");
    process.exit(0);
  }

  // 不一致：打印行级 hint
  console.error("[seed-check] FAIL · 两侧 INSERT 段不一致");
  const genLines = genBlock.split("\n");
  const v52Lines = v52Block.split("\n");
  console.error(`  脚本输出 ${genLines.length} 行 / v52 ${v52Lines.length} 行`);
  const max = Math.max(genLines.length, v52Lines.length);
  let diffCount = 0;
  for (let i = 0; i < max; i++) {
    if (genLines[i] !== v52Lines[i]) {
      diffCount++;
      if (diffCount <= 10) {
        console.error(`  行 ${i + 1}:`);
        console.error(`    v52:    ${v52Lines[i] ?? "(末尾)"}`);
        console.error(`    script: ${genLines[i] ?? "(末尾)"}`);
      }
    }
  }
  if (diffCount > 10) console.error(`  ... 共 ${diffCount} 行差异（仅展示前 10）`);
  process.exit(1);
}

main();
