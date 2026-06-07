/**
 * 6.4up · 权限管理 · 暴露 PERMISSION_KEYS 常量 + 内置模板给前端
 *
 * 用于权限管理页（/admin/permissions）的"新建角色"弹窗：
 *   - 展示可勾选的全部 permission_keys（按 resource 分组）
 *   - 展示内置模板按钮（一键填充推荐 permissions）
 *
 * 权限：仅 super_admin。
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { apiError } from "@/lib/api-error";
import {
  PERMISSION_KEYS,
  WORKFLOW_PERMISSION_KEYS,
  ADMIN_PERMISSION_KEYS,
  CUSTOM_ROLE_PERMISSION_KEYS,
  KEYS_BY_RESOURCE,
  PERMISSION_TEMPLATES,
  PermissionKey,
  getPermissionScopeSuffix,
  getPermissionAction,
  getPermissionResource,
} from "@/lib/permission-keys";

export const dynamic = "force-dynamic";

// 6.4up v2 Phase A · 按 set 分组返
//   workflow set：custom-roles 写入校验范围
//   admin set：admin-overrides 写入校验范围（v2 通道全集）
//   custom set：custom-roles 写入校验范围（6.6up 起等同 admin set）
//   PERMISSION_KEYS：两 set 并集 dedup，仅用于 type union / 总体清单
//   KEYS_BY_RESOURCE：按 resource 分块，给 UI Tab 1 / 2 矩阵展示
function describeKey(k: string) {
  const key = k as PermissionKey;
  return {
    key,
    resource: getPermissionResource(key),
    action: getPermissionAction(key),
    scope: getPermissionScopeSuffix(key),
    requiresSuperToGrant: getPermissionScopeSuffix(key) === "all",
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");

  return NextResponse.json({
    // v1 contract 兼容：keys = 所有 keys 的描述数组
    keys: PERMISSION_KEYS.map((k) => describeKey(k)),
    templates: PERMISSION_TEMPLATES,
    // 6.4up v2 Phase A · 新增分组
    workflow: WORKFLOW_PERMISSION_KEYS.map((k) => describeKey(k)),
    admin: ADMIN_PERMISSION_KEYS.map((k) => describeKey(k)),
    custom: CUSTOM_ROLE_PERMISSION_KEYS.map((k) => describeKey(k)),
    by_resource: Object.fromEntries(
      Object.entries(KEYS_BY_RESOURCE).map(([resource, keys]) => [
        resource,
        keys.map((k) => describeKey(k)),
      ]),
    ),
  });
}
