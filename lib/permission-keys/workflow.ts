/**
 * 6.4up v2 Phase A · WORKFLOW 通道 permission keys（custom 通道）
 *
 * 与 6.4up 原 `lib/permission-keys.ts` 的 PERMISSION_KEYS 完全一致：12 个 workflow keys。
 * 这些 keys 同时存在于 ADMIN_PERMISSION_KEYS（让 super 在 v2 通道也能 grant 给 builtin admin）。
 * 双通道独占的是**写入校验**而非 key 本身：
 *   - custom-roles POST/PATCH → 入参严校 WORKFLOW_PERMISSION_KEYS
 *   - admin-overrides POST/PATCH（v2 新）→ 入参严校 ADMIN_PERMISSION_KEYS
 */

export const WORKFLOW_PERMISSION_KEYS = [
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

export type WorkflowPermissionKey = (typeof WORKFLOW_PERMISSION_KEYS)[number];

// ─── 内置模板（v2 保留 6.4up 模板，仅 workflow 通道用） ──────────

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
    permissions: readonly WorkflowPermissionKey[];
  }
>;

export type PermissionTemplateCode = keyof typeof PERMISSION_TEMPLATES;
