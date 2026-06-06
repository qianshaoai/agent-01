/**
 * 6.4up Phase A · 权限管理 v2 现状扫描
 *
 * 扫描 app/api/admin/**\/route.ts，提取每个 route 文件里出现的 role 校验 pattern，
 * 输出 raw 清单 markdown 供人工对照填写完整矩阵：
 *   upgrade/6.4up/矩阵-资源权限现状-20260605.md
 *
 * 识别的 pattern：
 *   1. requireWriteAccess(admin, [roles...])
 *   2. requireReadAccess(admin, [roles...])
 *   3. if (admin.role === "X") / if (admin.role !== "X")
 *   4. 直接的角色白名单常量（const XXX_ROLES = [...]）
 *
 * 用法：
 *   npx tsx scripts/audit-permission-coverage.ts > upgrade/6.4up/审计-原始-20260605.md
 *
 * 注意：这是半自动工具——输出的"identified_roles"列是直接 grep 出来的字面值，
 *      未做语义合成；最终矩阵需要人工 review 每个 route 并补全 structural_constraint
 *      / proposed_permission_key / proposed_role_seed 三列。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "app/api/admin";

type Hit = {
  file: string;
  method: string; // GET / POST / PATCH / DELETE / 多个
  requireWriteRoles: string[];
  requireReadRoles: string[];
  inlineRoleEquals: string[]; // 出现的 if (admin.role === "X") 的 X 集合
  inlineRoleNotEquals: string[];
  constRoleArrays: string[]; // 文件里 const FOO_ROLES = [...] 命中
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (entry === "route.ts") acc.push(p);
  }
  return acc;
}

function extractMethods(src: string): string[] {
  const methods = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PATCH|PUT|DELETE)\b/g;
  let m;
  while ((m = re.exec(src)) !== null) methods.add(m[1]);
  return [...methods];
}

function extractList(src: string, fnName: string): string[] {
  // 匹配 requireWriteAccess(xxx, ["role1", "role2"])
  const re = new RegExp(`${fnName}\\([^,]+,\\s*\\[([^\\]]+)\\]`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const items = [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
    out.push(items.join("|"));
  }
  return out;
}

function extractInlineRole(src: string, op: "===" | "!=="): string[] {
  const re = new RegExp(`admin\\.role\\s*${op}\\s*["']([a-z_]+)["']`, "g");
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out];
}

function extractConstArrays(src: string): string[] {
  const re = /const\s+([A-Z_][A-Z0-9_]*ROLES?)\s*[:=]/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out];
}

function pathFromRouteFile(p: string): string {
  // app/api/admin/model-providers/[id]/route.ts → /api/admin/model-providers/[id]
  return "/" + p.replace(/\\/g, "/").replace(/\/route\.ts$/, "").replace(/^app\//, "");
}

function main() {
  const files = walk(ROOT).sort();
  const hits: Hit[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf-8");
    const hit: Hit = {
      file: f,
      method: extractMethods(src).join("/") || "?",
      requireWriteRoles: extractList(src, "requireWriteAccess"),
      requireReadRoles: extractList(src, "requireReadAccess"),
      inlineRoleEquals: extractInlineRole(src, "==="),
      inlineRoleNotEquals: extractInlineRole(src, "!=="),
      constRoleArrays: extractConstArrays(src),
    };
    hits.push(hit);
  }

  // 输出 markdown 表
  console.log("# 6.4up Phase A · 权限管理 v2 现状审计（原始扫描）");
  console.log("");
  console.log(`扫描 ${files.length} 个 admin route 文件，自动提取 role 校验 pattern。`);
  console.log("**这是半自动产物**——final 矩阵需对照每行人工补齐。");
  console.log("");
  console.log("| Route | Methods | requireWriteAccess | requireReadAccess | `admin.role ===` | `admin.role !==` | const ROLES |");
  console.log("|---|---|---|---|---|---|---|");
  for (const h of hits) {
    const fmt = (a: string[]) => (a.length === 0 ? "—" : a.join(" · "));
    console.log(
      `| ${pathFromRouteFile(relative(".", h.file))} | ${h.method} | ${fmt(h.requireWriteRoles)} | ${fmt(h.requireReadRoles)} | ${fmt(h.inlineRoleEquals)} | ${fmt(h.inlineRoleNotEquals)} | ${fmt(h.constRoleArrays)} |`,
    );
  }
}

main();
