#!/usr/bin/env node
// 5.19up · dev server 启动包装
//
// 起因：低内存环境下 Turbopack 的子进程 worker 容易在编译时被压死，
//       表现为 `Jest worker encountered N child process exceptions, exceeding retry limit`
//       （这里的 "Jest worker" 是 Next.js 内部用的 jest-worker 包，与 Jest 测试无关）。
//
// 处理：在启动 next 之前把 NODE_OPTIONS 的 --max-old-space-size 提到 4096MB，
//       给 worker 留更多堆内存。命令行参数（如 --port、--webpack）透传给 next dev。
//
// 仍崩怎么办：4G 还压不住 → 把本脚本传给 next dev 的参数加 "--webpack"，
//       彻底关掉 Turbopack 用 webpack（更慢但 worker 更少、更稳）。

import { spawn } from "node:child_process";

const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim(),
};

const args = ["next", "dev", ...process.argv.slice(2)];
const child = spawn("npx", args, { stdio: "inherit", shell: true, env });

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[scripts/dev.mjs] failed to spawn next dev:", err);
  process.exit(1);
});
