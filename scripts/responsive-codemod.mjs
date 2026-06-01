#!/usr/bin/env node
// 6.1up Phase 0 · 响应式 codemod 扫描工具
// 扫 app/ + components/ 下 .tsx / .ts，按 R1.1 方案 D1 节 9 类规则识别硬编码。
// 不自动改文件，只产 markdown 报告。
// 用法：node scripts/responsive-codemod.mjs

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];
const OUT_FILE = "upgrade/6.1up/codemod-report-20260601.md";

const KEY_PAGES = new Set([
  "app/admin/agent-builder/[id]/page.tsx",
  "app/agents/[id]/page.tsx",
  "app/admin/agents/page.tsx",
  "app/admin/users/page.tsx",
  "app/admin/model-providers/page.tsx",
  "app/admin/workflows/page.tsx",
  "app/admin/knowledge-bases/page.tsx",
  "app/admin/knowledge-bases/[id]/page.tsx",
  "components/layout/admin-layout.tsx",
  "components/ui/page-header.tsx",
]);

const RULES = [
  {
    id: 1,
    name: "任意值宽高",
    category: "A",
    pattern: /\b(?:min-|max-)?(?:w|h)-\[\d+(?:px|rem)\]/g,
    advice: "改 responsive prefix 或 var(--sidebar-w) 等容器 token",
    risk: "低",
  },
  {
    id: 2,
    name: "任意值内边距",
    category: "C",
    pattern: /\bp[xytrbl]?-\[\d+(?:px|rem)\]/g,
    advice: "改 var(--page-px) / var(--gap-card) token 或 Tailwind 预设 spacing",
    risk: "低",
  },
  {
    id: 3,
    name: "任意值字号（慎改）",
    category: "C",
    pattern: /\btext-\[\d+px\]/g,
    advice: "已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留",
    risk: "中",
  },
  {
    id: 4,
    name: "任意值圆角",
    category: "C",
    pattern: /\brounded(?:-\w+)?-\[\d+px\]/g,
    advice: "改 var(--radius-sm) / var(--radius-lg) token",
    risk: "低",
  },
  {
    id: 5,
    name: "grid-cols 固定宽",
    category: "D",
    pattern: /\bgrid-cols-\[[^\]]*\d+px[^\]]*\]/g,
    advice: "加 responsive prefix（lg:grid-cols-[Xfr_Ypx]）或换 [Xfr_var(--side-panel-w)]",
    risk: "高",
  },
  {
    id: 6,
    name: "w-N / h-N 文字数字预设",
    category: "D",
    pattern: /\b(?:w|h)-(?:48|56|60|64|72|80|96)\b(?!:)/g,
    advice: "若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留",
    risk: "中",
  },
  {
    id: 7,
    name: "max-w 大尺寸预设",
    category: "D",
    pattern: /\bmax-w-(?:4xl|5xl|6xl|7xl|screen-xl|screen-2xl|\[1[2-9]\d{2,3}px\])/g,
    advice: "改 max-w-[var(--content-max-w)]",
    risk: "高",
  },
  {
    id: 8,
    name: "内联 style 含 px/calc",
    category: "D",
    pattern: /style=\{\{[^}]*?(?:\d+px|calc\([^)]*\))[^}]*?\}\}/g,
    advice: "逐 case 评估，可能要换 grid / flex / token",
    risk: "高",
  },
  {
    // R1.2 补 · 小B P0 验收漏项 · 布局间距 / 偏移类
    //   匹配：负 margin（含文字数字 + 任意值）/ 正 margin 任意值或 ≥10 文字数字
    //   / 绝对定位 top/right/bottom/left 任意值 / gap 任意值
    //   过滤：m-0 / mt-1 等小值正 margin（noise 大、多为合法）
    id: 9,
    name: "布局间距 / 偏移类",
    category: "D",
    pattern: /(?:-m[trblxy]?-(?:\d+|\[[^\]]+\]))|(?:\bm[trblxy]?-(?:\[[^\]]+\]|\d{2,}\b))|(?:\b(?:top|right|bottom|left)-\[[^\]]+\])|(?:\bgap-\[[^\]]+\])/g,
    advice: "负 margin / 绝对定位偏移 / 任意值 gap 与容器对齐相关，调容器尺寸时要同步；逐 case 评估",
    risk: "高",
  },
];

function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walk(full));
    else if (/\.(tsx?|jsx?)$/.test(name)) files.push(full);
  }
  return files;
}

function escalateRisk(base, isKey) {
  if (!isKey) return base;
  if (base === "低") return "中";
  if (base === "中") return "高";
  return "高";
}

function scanFile(filepath) {
  const rel = relative(ROOT, filepath).replace(/\\/g, "/");
  const isKey = KEY_PAGES.has(rel);
  const text = readFileSync(filepath, "utf8");
  const lines = text.split("\n");
  const hits = [];
  for (const rule of RULES) {
    lines.forEach((line, idx) => {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      let m;
      while ((m = re.exec(line)) !== null) {
        hits.push({
          file: rel,
          line: idx + 1,
          rule: rule.id,
          name: rule.name,
          category: rule.category,
          match: m[0],
          advice: rule.advice,
          risk: escalateRisk(rule.risk, isKey),
          isKey,
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
  }
  return hits;
}

function fmtCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function main() {
  const allFiles = [];
  for (const d of SCAN_DIRS) allFiles.push(...walk(join(ROOT, d)));
  const allHits = [];
  for (const f of allFiles) allHits.push(...scanFile(f));

  const byFile = new Map();
  for (const h of allHits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }

  const byRule = new Map();
  for (const h of allHits) {
    if (!byRule.has(h.rule)) byRule.set(h.rule, []);
    byRule.get(h.rule).push(h);
  }

  const riskCounts = { 低: 0, 中: 0, 高: 0 };
  for (const h of allHits) riskCounts[h.risk] = (riskCounts[h.risk] ?? 0) + 1;

  const keyFiles = [...byFile.keys()].filter((f) => KEY_PAGES.has(f)).sort();
  const otherFiles = [...byFile.keys()].filter((f) => !KEY_PAGES.has(f)).sort();

  const out = [];
  out.push("# 6.1up · Phase 0 · 响应式 codemod 扫描报告（2026-06-01）");
  out.push("");
  out.push("> 由 [`scripts/responsive-codemod.mjs`](../../scripts/responsive-codemod.mjs) 自动产出。");
  out.push("> 扫 `app/` + `components/` 下 .tsx/.ts，按 R1.1 方案 D1 节 9 类规则识别。");
  out.push("> **不自动改文件**，本报告仅作改造依据。");
  out.push("");
  out.push("---");
  out.push("");
  out.push("## 总览");
  out.push("");
  out.push(`- 扫描文件数：**${allFiles.length}**`);
  out.push(`- 命中文件数：**${byFile.size}**`);
  out.push(`- 命中条目数：**${allHits.length}**`);
  out.push(`- 关键文件命中数：**${keyFiles.length}** / C4 名单 10 文件`);
  out.push("");
  out.push("## 按规则统计");
  out.push("");
  out.push("| # | 规则 | 类别 | 命中数 | 主要改造方向 |");
  out.push("|---|---|---|---|---|");
  for (const r of RULES) {
    const cnt = (byRule.get(r.id) ?? []).length;
    out.push(`| ${r.id} | ${fmtCell(r.name)} | ${r.category} | ${cnt} | ${fmtCell(r.advice)} |`);
  }
  out.push("");
  out.push("## 按风险等级统计");
  out.push("");
  out.push(`- 低（可直接 apply）: **${riskCounts.低}**`);
  out.push(`- 中（关键页面 / 慎改字号）: **${riskCounts.中}**`);
  out.push(`- 高（layout / 架构讨论）: **${riskCounts.高}**`);
  out.push("");
  out.push("---");
  out.push("");
  out.push("## 按文件分组（关键页面优先）");
  out.push("");

  for (const file of [...keyFiles, ...otherFiles]) {
    const hits = byFile.get(file);
    const tag = KEY_PAGES.has(file) ? " 🔑 关键" : "";
    out.push(`### \`${file}\`${tag} · ${hits.length} 条命中`);
    out.push("");
    out.push("| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |");
    out.push("|---|---|---|---|---|---|");
    for (const h of hits) {
      out.push(
        `| ${h.line} | ${h.category} | ${h.risk} | #${h.rule} ${fmtCell(h.name)} | \`${fmtCell(h.match)}\` | ${fmtCell(h.advice)} |`
      );
    }
    out.push("");
  }

  try {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
  } catch {}
  writeFileSync(OUT_FILE, out.join("\n"), "utf8");

  console.log(`OK report -> ${OUT_FILE}`);
  console.log(`   scanned ${allFiles.length} files, hits ${allHits.length} (in ${byFile.size} files)`);
  console.log(`   risk: 低 ${riskCounts.低} / 中 ${riskCounts.中} / 高 ${riskCounts.高}`);
}

main();
