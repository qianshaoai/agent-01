/**
 * 5.11up · 管理员上下级权限工具
 *
 * 层级（高 → 低）：
 *   super_admin (3) > system_admin (2) > org_admin (1)
 *
 * 规则：actor 等级 ≥ creator 等级 才能动 creator 创建的资源。
 *
 * 决策记录（来自 5.11up 方案稿）：
 *   - 决策 1 = B：历史无 creator 信息的资源已在 migration_v31 回填为 system_admin
 *     这里也兜底：如果运行时仍读到 NULL（migration 未跑），按 system_admin 处理
 *   - 决策 3 = A：使用 snapshot —— 比较的是创建时的角色，不是当前角色
 */

export type AdminRole = "super_admin" | "system_admin" | "org_admin";

const ROLE_LEVEL: Record<AdminRole, number> = {
  super_admin: 3,
  system_admin: 2,
  org_admin: 1,
};

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "超级管理员",
  system_admin: "系统管理员",
  org_admin: "组织管理员",
};

/**
 * 判断 actor 是否能对 creator 创建的资源执行写操作。
 * creatorRole 为 null/未知时按 system_admin 处理（兜底）。
 */
export function canActOnRole(
  actorRole: AdminRole,
  creatorRole: AdminRole | null | undefined
): boolean {
  const cr = (creatorRole ?? "system_admin") as AdminRole;
  return ROLE_LEVEL[actorRole] >= ROLE_LEVEL[cr];
}

/** 取角色的中文标签，给 UI 和错误信息用 */
export function roleLabel(role: AdminRole | null | undefined): string {
  if (!role) return "系统管理员"; // 兜底
  return ROLE_LABEL[role] ?? role;
}

/** 标准化的 403 错误信息文本 */
export function noWritePermissionMessage(creatorRole: AdminRole | null | undefined): string {
  return `无权操作：该工作流由${roleLabel(creatorRole)}创建，需要同级或更高权限`;
}
