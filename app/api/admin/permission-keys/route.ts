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
  PERMISSION_TEMPLATES,
  getPermissionScopeSuffix,
  getPermissionAction,
  getPermissionResource,
} from "@/lib/permission-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (admin.role !== "super_admin") return apiError("仅超级管理员可操作", "FORBIDDEN");

  const keys = PERMISSION_KEYS.map((k) => ({
    key: k,
    resource: getPermissionResource(k),
    action: getPermissionAction(k),
    scope: getPermissionScopeSuffix(k),
    requiresSuperToGrant: getPermissionScopeSuffix(k) === "all",
  }));

  return NextResponse.json({
    keys,
    templates: PERMISSION_TEMPLATES,
  });
}
