// 5.20up · standalone 发布静态资源补拷
//
// next.config.ts 用了 output: "standalone"；Next.js 不会把 .next/static 和 public 拷进
// standalone 产物（仅拷 .next/server + 必要 node_modules）。直接跑 server.js 会出现
//   /_next/static/...  → 404
//   /favicon.ico (等) → 404
// → 前端 JS/CSS 加载失败、白屏，但 /api/health 仍 200，容易误判"服务没问题"。
//
// 本脚本：build 之后跑一次，把 .next/static 和 public 全量拷进 standalone 子目录。
// 跨平台（Node fs.cpSync）—— 不用 PowerShell / bash 各写一份。

import { readdirSync, statSync, existsSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const STANDALONE_ROOT = ".next/standalone";

if (!existsSync(STANDALONE_ROOT)) {
  console.error(
    `[copy-standalone-assets] ${STANDALONE_ROOT} 不存在 —— 请先跑 "next build"（或 npm run build）`,
  );
  process.exit(1);
}

// monorepo / 父目录有 lockfile 时，Next 把项目目录嵌一层（如 agent-01/）；
// 单包项目时 server.js 在 standalone 根。统一靠"找含 server.js 的目录"定位运行时根。
function findServerRoot(dir) {
  if (existsSync(join(dir, "server.js"))) return dir;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue; // 跳过依赖目录，加快递归
    const sub = join(dir, name);
    try {
      if (statSync(sub).isDirectory()) {
        const found = findServerRoot(sub);
        if (found) return found;
      }
    } catch {
      // 符号链接/权限错误等忽略
    }
  }
  return null;
}

const serverRoot = findServerRoot(STANDALONE_ROOT);
if (!serverRoot) {
  console.error(
    `[copy-standalone-assets] 在 ${STANDALONE_ROOT} 下找不到 server.js —— 是不是构建失败/中断了？`,
  );
  process.exit(1);
}

const tasks = [
  {
    src: ".next/static",
    dst: join(serverRoot, ".next/static"),
    label: ".next/static（JS/CSS chunks）",
    required: true,
  },
  {
    src: "public",
    dst: join(serverRoot, "public"),
    label: "public（favicon / 静态图 等）",
    required: false,
  },
];

for (const { src, dst, label, required } of tasks) {
  if (!existsSync(src)) {
    const msg = `[copy-standalone-assets] 源不存在：${label}（${src}）`;
    if (required) {
      console.error(`${msg} —— 这是前端页面必需资源，终止发布产物生成`);
      process.exit(1);
    }
    console.log(`${msg}，跳过`);
    continue;
  }
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true, force: true });
  if (!existsSync(dst)) {
    console.error(`[copy-standalone-assets] 拷贝后目标不存在：${dst}`);
    process.exit(1);
  }
  console.log(`[copy-standalone-assets] ✓ ${label}\n    ${src} → ${dst}`);
}

console.log(`[copy-standalone-assets] done · standalone 运行时根 = ${serverRoot}`);
console.log(`[copy-standalone-assets] 启动命令： node ${join(serverRoot, "server.js")}`);
