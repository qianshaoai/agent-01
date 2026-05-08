import { db } from "@/lib/db";

export type AuditAction = "create" | "update" | "delete" | "enable" | "disable";
export type AuditResourceType = "agent" | "workflow";

export async function writeAuditLog(params: {
  adminId: string;
  adminUsername: string;
  adminRole: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string;
  resourceName?: string;
  detail?: Record<string, unknown>;
}) {
  const { error } = await db.from("audit_logs").insert({
    admin_id: params.adminId,
    admin_username: params.adminUsername,
    admin_role: params.adminRole,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId ?? null,
    resource_name: params.resourceName ?? null,
    detail: params.detail ?? {},
  });
  if (error) {
    console.error("[audit] write failed:", error.message, params);
  }
}
