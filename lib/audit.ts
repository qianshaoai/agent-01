import { db } from "@/lib/db";

// 5.14up PR-A · 新增 'test'（模型供应商连通性测试）
export type AuditAction = "create" | "update" | "delete" | "enable" | "disable" | "test";
export type AuditResourceType =
  | "agent" | "workflow" | "workflow_step"
  | "category" | "wf_category"
  | "notice" | "tenant" | "user"
  | "department" | "team" | "user_group"
  | "settings" | "resource_permission"
  // 5.14up PR-A · 平台级模型供应商（model_providers 表，无组织归属）
  | "model_provider";

/**
 * 5.11up · 写时反查资源所属的组织 code
 *
 * 不同 resource_type 反查路径不同；任何反查失败均返回 null（资源已删除等场景）。
 * 全局资源（category / wf_category / user_group / settings / resource_permission）
 * 无明确组织归属，返回 null（org_admin 看不到这些）。
 *
 * 注意：DELETE 操作必须在删除前调用本函数缓存结果，然后传给 writeAuditLog 的
 * resourceTenantCode 参数；否则资源已删除时反查必然返回 null，审计记录就会丢失组织归属。
 */
export async function resolveResourceTenantCode(
  resourceType: AuditResourceType,
  resourceId: string
): Promise<string | null> {
  try {
    switch (resourceType) {
      case "notice": {
        const { data } = await db.from("notices").select("tenant_code").eq("id", resourceId).maybeSingle();
        return data?.tenant_code ?? null;
      }
      case "workflow": {
        const { data } = await db
          .from("resource_permissions")
          .select("scope_id")
          .eq("resource_type", "workflow")
          .eq("resource_id", resourceId)
          .eq("scope_type", "org")
          .limit(1)
          .maybeSingle();
        return data?.scope_id ?? null;
      }
      case "workflow_step": {
        const { data: step } = await db.from("workflow_steps").select("workflow_id").eq("id", resourceId).maybeSingle();
        if (!step?.workflow_id) return null;
        return resolveResourceTenantCode("workflow", step.workflow_id);
      }
      case "user": {
        const { data } = await db.from("users").select("tenant_code").eq("id", resourceId).maybeSingle();
        return data?.tenant_code ?? null;
      }
      case "department": {
        const { data } = await db.from("departments").select("tenant_code").eq("id", resourceId).maybeSingle();
        return data?.tenant_code ?? null;
      }
      case "team": {
        const { data: team } = await db.from("teams").select("dept_id").eq("id", resourceId).maybeSingle();
        if (!team?.dept_id) return null;
        const { data: dept } = await db.from("departments").select("tenant_code").eq("id", team.dept_id).maybeSingle();
        return dept?.tenant_code ?? null;
      }
      case "tenant":
        return resourceId; // tenant 的 resourceId 本身就是 tenant code
      case "agent": {
        const { data } = await db
          .from("tenant_agents")
          .select("tenant_code")
          .eq("agent_id", resourceId)
          .limit(1)
          .maybeSingle();
        return data?.tenant_code ?? null;
      }
      default:
        return null;
    }
  } catch (e) {
    console.error("[audit] resolveResourceTenantCode failed:", resourceType, resourceId, e);
    return null;
  }
}

export async function writeAuditLog(params: {
  adminId: string;
  adminUsername: string;
  adminRole: string;
  // 5.11up · 操作发起人所属组织（org_admin 才有值，super/system 留 null）
  adminTenantCode?: string | null;
  // 5.11up · 资源所属组织。优先用显式传入（DELETE 路由必须预先 resolve 后传入），
  // 否则按 resourceId 自动反查（CREATE / UPDATE 路径正常）。
  resourceTenantCode?: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  resourceName?: string;
  detail?: Record<string, unknown>;
}) {
  // 5.11up · 写时反查资源归属，落到 resource_tenant_code 列
  const resourceTenantCode =
    params.resourceTenantCode !== undefined
      ? params.resourceTenantCode
      : params.resourceId
      ? await resolveResourceTenantCode(params.resourceType, params.resourceId)
      : null;

  const { error } = await db.from("audit_logs").insert({
    admin_id: params.adminId,
    admin_username: params.adminUsername,
    admin_role: params.adminRole,
    admin_tenant_code: params.adminTenantCode ?? null,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId ?? null,
    resource_name: params.resourceName ?? null,
    resource_tenant_code: resourceTenantCode,
    detail: params.detail ?? {},
  });
  if (error) {
    console.error("[audit] write failed:", error.message, params);
  }
}
