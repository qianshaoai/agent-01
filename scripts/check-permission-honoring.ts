/**
 * 6.6up · 权限键 honoring 自检（防"矩阵能授但后端没人认"这一类 bug）
 *
 * 背景：6.6up 把 ADMIN_PERMISSION_KEYS 全集开放给自定义角色去授，但部分动作后端没接
 *   honoring（如 workflow.enable 曾被硬拒、agent.reindex 无路由）→ 授了白授 / 报"权限不足"。
 *
 * 做法（声明式，避免静态正则对动态 key 构造的脆弱）：
 *   - HONORED_ACTIONS：手维护「每个资源后端确有 honoring 路径的动作集」（已审计现状）。
 *   - INTENTIONAL_ORPHANS：手登记「可授但后端确无 honoring 的键」（带原因）。
 *   断言：ADMIN_PERMISSION_KEYS 里每个 (resource,action) 要么在 HONORED_ACTIONS，要么在
 *   INTENTIONAL_ORPHANS；否则退出码 1。
 *
 * 维护规则（关键）：新增 permission key 时，**必须**：要么给对应路由接 requireAccess/hasPermission
 *   并在 HONORED_ACTIONS 补上该动作；要么登记 INTENTIONAL_ORPHANS 并写清原因（最好同时从键集移除）。
 *   —— 这样"加了键却没人认"会在本检查当场报红，而不是上线后用户撞。
 *
 * 跑法：tsx scripts/check-permission-honoring.ts（已挂到 package.json 的 ci:test）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_PERMISSION_KEYS } from "../lib/permission-keys/admin";

const SCOPES = new Set(["team", "dept", "org", "all"]);

/** "user.role.update.org" → {resource:"user", action:"role.update"} */
function parseKey(key: string): { resource: string; action: string } {
  const parts = key.split(".");
  const last = parts[parts.length - 1];
  const body = SCOPES.has(last) ? parts.slice(0, -1) : parts;
  return { resource: body[0], action: body.slice(1).join(".") };
}

const PERMISSION_PREFIX_BY_RESOURCE_KIND: Record<string, string> = {
  knowledge_base: "kb",
  model_provider: "provider",
};

function permissionPrefixFor(resourceKind: string): string {
  return PERMISSION_PREFIX_BY_RESOURCE_KIND[resourceKind] ?? resourceKind;
}

function buildAllowedActions(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const key of ADMIN_PERMISSION_KEYS) {
    const { resource, action } = parseKey(key);
    (out[resource] ??= new Set<string>()).add(action);
  }
  return out;
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...listFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * 各资源「后端确有 honoring 路径」的动作集（2026-06-08 审计现状）。
 * 校验入口对照：app/api/admin 下 requireAccess(actor,"R","A") / hasPermission(actor,"R.A.S")
 *   / 自定义角色专用分支（workflow 的 pickXKey + hasPermission、agent_draft 的 hasOwnDraftAction 等）。
 */
const HONORED_ACTIONS: Record<string, Set<string>> = {
  // workflow：read/create/update 走 custom 专用分支；enable(6.6up Fix)/duplicate/delete 走 requireAccess
  workflow: new Set(["read", "create", "update", "enable", "duplicate", "delete"]),
  // agent（已发布）：agents/[id] + category-display + picker，requireAccess(agent,*)
  agent: new Set(["read", "basic.update", "enable", "delete"]),
  // agent_draft：agent-drafts 全套（duplicate 经 hasOwnDraftAction）
  agent_draft: new Set(["read", "create", "update", "delete", "duplicate", "publish", "test"]),
  // kb：knowledge-bases requireAccess(knowledge_base,*)
  kb: new Set(["read", "create", "update", "delete"]),
  // provider：model-providers requireAccess(model_provider,*)
  provider: new Set(["read", "create", "update", "delete", "test"]),
  notice: new Set(["read", "create", "update", "delete"]),
  // user：users/[id] 用 USER_SUBACTION 把 body.action 映射成 sub 再 requireAccess(actor,"user",sub)
  user: new Set([
    "read",
    "enable",
    "role.update",
    "tenant.transfer",
    "department.assign",
    "password.reset",
    "delete",
  ]),
  tenant: new Set(["read", "create", "update", "delete"]),
  category: new Set(["read", "create", "update", "delete"]),
  dept: new Set(["read", "create", "update", "delete"]),
  team: new Set(["read", "create", "update", "delete"]),
  user_group: new Set(["read", "create", "update", "delete"]),
  audit: new Set(["read"]),
};

/**
 * 已知孤儿键：可授但后端确无 honoring 路径。登记 = 已知、CI 放过；
 * 长期应"接上路由"或"从 ADMIN_PERMISSION_KEYS 移除"（见 upgrade/6.6up/变更记录-20260608 条目 10）。
 */
const INTENTIONAL_ORPHANS = new Set<string>([
  "agent.reindex.all", // 无 agent reindex 功能/路由
  "user.create.org", // admin 不建用户（用户自助注册），/api/admin/users 只有 GET
  "user.create.all",
  "user.team.assign.org", // 团队分配并入 set-dept → 走 user.department.assign，无独立 set-team 动作
  "user.team.assign.all",
]);

const orphans: string[] = [];
for (const key of ADMIN_PERMISSION_KEYS) {
  if (INTENTIONAL_ORPHANS.has(key)) continue;
  const { resource, action } = parseKey(key);
  if (HONORED_ACTIONS[resource]?.has(action)) continue;
  orphans.push(key);
}

const allowedActions = buildAllowedActions();
const invalidRequireAccessCalls: string[] = [];
const requireAccessCallRe =
  /requireAccess\s*\(\s*[^,]+,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
for (const file of listFiles(join(process.cwd(), "app", "api", "admin"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(requireAccessCallRe)) {
    const resourceKind = m[1];
    const action = m[2];
    const permissionPrefix = permissionPrefixFor(resourceKind);
    if (allowedActions[permissionPrefix]?.has(action)) continue;
    invalidRequireAccessCalls.push(
      `${file.replace(process.cwd() + "\\", "")}: requireAccess("${resourceKind}", "${action}")`,
    );
  }
}

if (orphans.length > 0) {
  console.error(
    "[check-permission-honoring] 以下权限键未声明 honoring（授了可能白授 / 报权限不足）：",
  );
  for (const k of orphans) console.error("  - " + k);
  console.error(
    "修法：① 给对应路由接 requireAccess/hasPermission，并在 HONORED_ACTIONS 补该动作；" +
      "② 或登记 INTENTIONAL_ORPHANS 并写清原因（建议同时从键集移除）。",
  );
  process.exit(1);
}

if (invalidRequireAccessCalls.length > 0) {
  console.error(
    "[check-permission-honoring] 以下 requireAccess 静态 action 不在权限键清单中（可能永远 403）：",
  );
  for (const item of invalidRequireAccessCalls) console.error("  - " + item);
  console.error("修法：把 action 改成对应 permission key 的中段，或补充合法权限键。");
  process.exit(1);
}

console.log(
  "[check-permission-honoring] OK · " +
    ADMIN_PERMISSION_KEYS.length +
    " keys 全部有 honoring 声明（含 " +
    INTENTIONAL_ORPHANS.size +
    " 个已登记孤儿键）。",
);
