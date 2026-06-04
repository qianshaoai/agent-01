/**
 * 6.4up · 权限管理 · permission_key 常量定义
 *
 * 单一来源原则（方案 R1.2 P1-2）：
 *   - DB 不加 CHECK（避免 enum 改一次发一次 migration）
 *   - 此文件是后端唯一可信来源
 *   - custom-roles POST/PUT API 入参必须用 isPermissionKey() 校验
 *
 * Naming convention: <resource>.<action>.<scope>
 *   - resource：当前仅 workflow（v1 试点）
 *   - action：read / create / update
 *   - scope：team < dept < org < all（小 ⊂ 大；持 .org 蕴含可写 dept/team 范围内）
 *
 * scope 包含关系（方案 § hasPermission scope 章节）：
 *   - .team：仅 actor.teamId
 *   - .dept：actor.deptId 本身 + 该 dept 下的 team
 *   - .org：actor.tenantCode 本身 + 本组织下 dept/team
 *   - .all：scope_type='all' 的资源 + 全部组织
 *
 * R1.2 § Phase 2 守门：`.all` 后缀仅 super_admin 可授予；非超管 POST/PUT 含 .all 权限 → 403
 */

export const PERMISSION_KEYS = [
  // workflow read
  "workflow.read.team",
  "workflow.read.dept",
  "workflow.read.org",
  "workflow.read.all",
  // workflow create
  "workflow.create.team",
  "workflow.create.dept",
  "workflow.create.org",
  "workflow.create.all",
  // workflow update
  "workflow.update.team",
  "workflow.update.dept",
  "workflow.update.org",
  "workflow.update.all",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const PERMISSION_KEY_SET = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(x: unknown): x is PermissionKey {
  return typeof x === "string" && PERMISSION_KEY_SET.has(x);
}

/** 后缀解析：取 `.` 之后最后一段判 scope 等级 */
export type PermissionScopeSuffix = "team" | "dept" | "org" | "all";

export function getPermissionScopeSuffix(key: PermissionKey): PermissionScopeSuffix {
  const idx = key.lastIndexOf(".");
  return key.slice(idx + 1) as PermissionScopeSuffix;
}

export function getPermissionAction(key: PermissionKey): "read" | "create" | "update" {
  const parts = key.split(".");
  return parts[1] as "read" | "create" | "update";
}

export function getPermissionResource(key: PermissionKey): "workflow" {
  const parts = key.split(".");
  return parts[0] as "workflow";
}

/** 持有 .all 的权限是否需要 super_admin 才能授予（R1.2 决策 10） */
export function requiresSuperAdminToGrant(key: PermissionKey): boolean {
  return getPermissionScopeSuffix(key) === "all";
}

// ─── 内置模板（方案 R1.2 决策点 5）────────────────────────────
//
// 模板只是 super_admin 创建 custom role 时的"一键填充"起点；
// 模板本身不进 DB，新建出来的 custom_role 与 custom_role_permissions
// 才是持久化对象。模板可改可删可不用，不影响已建角色。

export const PERMISSION_TEMPLATES = {
  group_leader: {
    label: "小组长",
    description: "本部门可见 + 本组内可创建 / 编辑工作流",
    permissions: [
      "workflow.read.dept",
      "workflow.create.team",
      "workflow.update.team",
    ],
  },
  dept_manager: {
    label: "部门负责人",
    description: "本组织可见 + 本部门内可创建 / 编辑工作流",
    permissions: [
      "workflow.read.org",
      "workflow.create.dept",
      "workflow.update.dept",
    ],
  },
  org_content_ops: {
    label: "组织内容运营",
    description: "本组织内可见 / 创建 / 编辑工作流",
    permissions: [
      "workflow.read.org",
      "workflow.create.org",
      "workflow.update.org",
    ],
  },
  org_auditor: {
    label: "组织审计",
    description: "仅可见本组织工作流（只读）",
    permissions: ["workflow.read.org"],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    description: string;
    permissions: readonly PermissionKey[];
  }
>;

export type PermissionTemplateCode = keyof typeof PERMISSION_TEMPLATES;
