/**
 * 6.4up v2 Phase A · ADMIN 通道 permission keys（v2 builtin admin override 全集）
 *
 * 用于 admin_permission_overrides 写入校验。包含：
 *   1. workflow 12 keys（与 WORKFLOW_PERMISSION_KEYS 重叠）
 *   2. workflow.enable/duplicate/delete.{team,dept,org,all}（v2 新增，仅 ADMIN 通道独占）
 *   3. agent_draft 系列（与 AGENT_DRAFT_PERMISSION_KEYS 重叠）
 *   4. agent / kb / provider / notice / user / tenant / category / dept / team / user_group / audit 系列
 *
 * scope 分级：见矩阵-资源权限现状-20260605.md
 * setting / permission 不入此表 —— super_admin 硬全权由公式第 1 行覆盖（方案 §3.2 / 验收 #7）
 */

import { WORKFLOW_PERMISSION_KEYS } from "./workflow";
import { AGENT_DRAFT_PERMISSION_KEYS } from "./agent-draft";

// ─── workflow v2 新增（enable/duplicate/delete） ─────────────────

const WORKFLOW_V2_NEW_KEYS = [
  "workflow.enable.team",
  "workflow.enable.dept",
  "workflow.enable.org",
  "workflow.enable.all",
  "workflow.duplicate.team",
  "workflow.duplicate.dept",
  "workflow.duplicate.org",
  "workflow.duplicate.all",
  "workflow.delete.team",
  "workflow.delete.dept",
  "workflow.delete.org",
  "workflow.delete.all",
] as const;

// ─── agent（已发布） ────────────────────────────────────────────

const AGENT_KEYS = [
  "agent.read.org",
  "agent.read.all",
  "agent.basic.update.org",
  "agent.basic.update.all",
  "agent.reindex.all",
  "agent.enable.org",
  "agent.enable.all",
  "agent.delete.org",
  "agent.delete.all",
] as const;

// ─── knowledge_base ─────────────────────────────────────────────

const KB_KEYS = [
  "kb.read.org",
  "kb.read.all",
  "kb.create.org",
  "kb.create.all",
  "kb.update.org",
  "kb.update.all",
  "kb.delete.org",
  "kb.delete.all",
] as const;

// ─── provider（model_providers / API 管理） ────────────────────

const PROVIDER_KEYS = [
  "provider.read.org",
  "provider.read.all",
  "provider.create.org",
  "provider.create.all",
  "provider.update.org",
  "provider.update.all",
  "provider.delete.org",
  "provider.delete.all",
  "provider.test.org",
  "provider.test.all",
] as const;

// ─── notice ─────────────────────────────────────────────────────

const NOTICE_KEYS = [
  "notice.read.org",
  "notice.read.all",
  "notice.create.org",
  "notice.create.all",
  "notice.update.org",
  "notice.update.all",
  "notice.delete.org",
  "notice.delete.all",
] as const;

// ─── user ───────────────────────────────────────────────────────

const USER_KEYS = [
  "user.read.org",
  "user.read.all",
  "user.create.org",
  "user.create.all",
  "user.role.update.org",
  "user.role.update.all",
  "user.tenant.transfer.org",
  "user.tenant.transfer.all",
  "user.department.assign.org",
  "user.department.assign.all",
  "user.team.assign.org",
  "user.team.assign.all",
  "user.password.reset.org",
  "user.password.reset.all",
  "user.enable.org",
  "user.enable.all",
  "user.delete.org",
  "user.delete.all",
] as const;

// ─── tenant ─────────────────────────────────────────────────────

const TENANT_KEYS = [
  "tenant.read.all",
  "tenant.create.all",
  "tenant.update.all",
  "tenant.delete.all",
] as const;

// ─── category / wf-categories ──────────────────────────────────

const CATEGORY_KEYS = [
  "category.read.all",
  "category.create.all",
  "category.update.all",
  "category.delete.all",
] as const;

// ─── dept ───────────────────────────────────────────────────────

const DEPT_KEYS = [
  "dept.read.org",
  "dept.read.all",
  "dept.create.org",
  "dept.create.all",
  "dept.update.org",
  "dept.update.all",
  "dept.delete.org",
  "dept.delete.all",
] as const;

// ─── team ───────────────────────────────────────────────────────

const TEAM_KEYS = [
  "team.read.org",
  "team.read.all",
  "team.create.org",
  "team.create.all",
  "team.update.org",
  "team.update.all",
  "team.delete.org",
  "team.delete.all",
] as const;

// ─── user_group ────────────────────────────────────────────────

const USER_GROUP_KEYS = [
  "user_group.read.org",
  "user_group.read.all",
  "user_group.create.org",
  "user_group.create.all",
  "user_group.update.org",
  "user_group.update.all",
  "user_group.delete.org",
  "user_group.delete.all",
] as const;

// ─── audit ──────────────────────────────────────────────────────

const AUDIT_KEYS = [
  "audit.read.org",
  "audit.read.all",
] as const;

// ─── 汇总（v2 通道全集） ───────────────────────────────────────

export const ADMIN_PERMISSION_KEYS = [
  ...WORKFLOW_PERMISSION_KEYS, // 12（与 WORKFLOW set 重叠）
  ...WORKFLOW_V2_NEW_KEYS,     // 12（仅 ADMIN）
  ...AGENT_KEYS,               // 9
  ...AGENT_DRAFT_PERMISSION_KEYS, // 14（与 AGENT_DRAFT set 重叠）
  ...KB_KEYS,                  // 8
  ...PROVIDER_KEYS,            // 10
  ...NOTICE_KEYS,              // 8
  ...USER_KEYS,                // 18
  ...TENANT_KEYS,              // 4
  ...CATEGORY_KEYS,            // 4
  ...DEPT_KEYS,                // 8
  ...TEAM_KEYS,                // 8
  ...USER_GROUP_KEYS,          // 8
  ...AUDIT_KEYS,               // 2
] as const;

export type AdminPermissionKey = (typeof ADMIN_PERMISSION_KEYS)[number];

// ─── 按 resource 分组（UI Tab 1 / 2 矩阵展示用） ────────────────

export const KEYS_BY_RESOURCE: Record<string, readonly string[]> = {
  workflow: [...WORKFLOW_PERMISSION_KEYS, ...WORKFLOW_V2_NEW_KEYS],
  agent: [...AGENT_KEYS],
  agent_draft: [...AGENT_DRAFT_PERMISSION_KEYS],
  kb: [...KB_KEYS],
  provider: [...PROVIDER_KEYS],
  notice: [...NOTICE_KEYS],
  user: [...USER_KEYS],
  tenant: [...TENANT_KEYS],
  category: [...CATEGORY_KEYS],
  dept: [...DEPT_KEYS],
  team: [...TEAM_KEYS],
  user_group: [...USER_GROUP_KEYS],
  audit: [...AUDIT_KEYS],
};

/**
 * 6.6up · 自定义角色从 workflow-only 升级为后台全资源权限。
 * custom_roles 仍写 custom_role_permissions 表，合法 key 集改为 ADMIN_PERMISSION_KEYS。
 */
export const CUSTOM_ROLE_PERMISSION_KEYS = ADMIN_PERMISSION_KEYS;
export type CustomRolePermissionKey = (typeof CUSTOM_ROLE_PERMISSION_KEYS)[number];
