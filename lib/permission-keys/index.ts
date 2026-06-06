/**
 * 6.4up v2 Phase A · permission-keys 聚合 entry
 *
 * 取代 lib/permission-keys.ts（旧文件）。所有 `from "@/lib/permission-keys"` 的 import
 * 经 TS 模块解析自动指向本文件，调用方无需改 import 路径。
 *
 * 暴露内容：
 *   - 三个 set 常量：WORKFLOW_PERMISSION_KEYS / ADMIN_PERMISSION_KEYS / PERMISSION_KEYS
 *   - 类型：PermissionKey / WorkflowPermissionKey / AdminPermissionKey
 *   - 类型守卫：isPermissionKey / isWorkflowPermissionKey / isAdminPermissionKey
 *   - scope 解析：getPermissionScopeSuffix / getPermissionAction / getPermissionResource
 *   - super-only 守门：requiresSuperAdminToGrant
 *   - 模板（向后兼容 6.4up）：PERMISSION_TEMPLATES / PermissionTemplateCode
 *   - UI 分组：KEYS_BY_RESOURCE
 */

import {
  WORKFLOW_PERMISSION_KEYS,
  WorkflowPermissionKey,
  PERMISSION_TEMPLATES,
  PermissionTemplateCode,
} from "./workflow";
import {
  ADMIN_PERMISSION_KEYS,
  AdminPermissionKey,
  KEYS_BY_RESOURCE,
} from "./admin";
import { AGENT_DRAFT_PERMISSION_KEYS, AgentDraftPermissionKey } from "./agent-draft";

// ─── PERMISSION_KEYS = 两 set 的并集（dedup） ──────────────────────
// workflow 12 keys 同时在 WORKFLOW 与 ADMIN 中；用 Set dedup。
// agent_draft keys 同时在 AGENT_DRAFT 与 ADMIN 中；同上。

export type PermissionKey =
  | WorkflowPermissionKey
  | AdminPermissionKey
  | AgentDraftPermissionKey;

const _allKeys = Array.from(
  new Set<string>([
    ...WORKFLOW_PERMISSION_KEYS,
    ...ADMIN_PERMISSION_KEYS,
    ...AGENT_DRAFT_PERMISSION_KEYS,
  ]),
) as PermissionKey[];

export const PERMISSION_KEYS: readonly PermissionKey[] = _allKeys;

const _workflowSet = new Set<string>(WORKFLOW_PERMISSION_KEYS);
const _adminSet = new Set<string>(ADMIN_PERMISSION_KEYS);
const _agentDraftSet = new Set<string>(AGENT_DRAFT_PERMISSION_KEYS);
const _allSet = new Set<string>(_allKeys);

export function isPermissionKey(x: unknown): x is PermissionKey {
  return typeof x === "string" && _allSet.has(x);
}

export function isWorkflowPermissionKey(x: unknown): x is WorkflowPermissionKey {
  return typeof x === "string" && _workflowSet.has(x);
}

export function isAdminPermissionKey(x: unknown): x is AdminPermissionKey {
  return typeof x === "string" && _adminSet.has(x);
}

export function isAgentDraftPermissionKey(x: unknown): x is AgentDraftPermissionKey {
  return typeof x === "string" && _agentDraftSet.has(x);
}

// ─── scope / action / resource 解析 ───────────────────────────────

export type PermissionScopeSuffix = "team" | "dept" | "org" | "all";

export function getPermissionScopeSuffix(key: PermissionKey): PermissionScopeSuffix {
  const idx = key.lastIndexOf(".");
  return key.slice(idx + 1) as PermissionScopeSuffix;
}

export function getPermissionAction(key: PermissionKey): string {
  // resource.action.scope  或  resource.sub.action.scope（如 agent.basic.update.org）
  const parts = key.split(".");
  // 倒数第一是 scope，前面除 resource 外都拼成 action
  return parts.slice(1, parts.length - 1).join(".");
}

export function getPermissionResource(key: PermissionKey): string {
  const parts = key.split(".");
  return parts[0];
}

/** 持有 .all 后缀的权限是否需要 super_admin 才能授予（决策 10） */
export function requiresSuperAdminToGrant(key: PermissionKey): boolean {
  return getPermissionScopeSuffix(key) === "all";
}

// ─── re-export ────────────────────────────────────────────────────

export {
  WORKFLOW_PERMISSION_KEYS,
  ADMIN_PERMISSION_KEYS,
  AGENT_DRAFT_PERMISSION_KEYS,
  PERMISSION_TEMPLATES,
  KEYS_BY_RESOURCE,
};

export type {
  WorkflowPermissionKey,
  AdminPermissionKey,
  AgentDraftPermissionKey,
  PermissionTemplateCode,
};
