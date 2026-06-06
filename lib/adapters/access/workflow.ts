// 6.4up v2 Phase D · D-0 · workflow resource access adapter（resource_permissions 反查）
//
// workflows 表无 tenant_code 列；归属 / scope 来自 resource_permissions（migration_v8，
// resource_type='workflow'）。Phase A stub 套 generic（select id, tenant_code）在 enforce 下会
// 因列不存在 → loadDetail 返 null → 404；本次按 R0.1 §5.1 重写为 resource_permissions 反查。
//
// 职责边界（R0.1 F1）：adapter 只算 scope + 调 hasPermission；上下级 hierarchy（canActOnRole）
// 与 workflow 创建写 resource_permissions 的逻辑仍保留在路由层。custom_admin 通道不走 facade。
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { hasPermission, ResourceScope } from "@/lib/permission-actor";
import { db } from "@/lib/db";
import { PermissionKey } from "@/lib/permission-keys";
import { mapResourcePermissionRowsToScopes, RawScopeRow } from "./_scope-utils";
import { checkAnyScopedPermission } from "./_generic";

type WorkflowRow = { id: string; scopes: ResourceScope[] };

export const workflowAccessAdapter: ResourceAccessAdapter<WorkflowRow> = {
  resourceKind: "workflow",

  listFilter: () => null,

  async loadDetail(id) {
    // 先确认 workflow 存在（区分"不存在→404" vs "存在但无 scope 行→scopes=[]"）
    const { data: wf } = await db.from("workflows").select("id").eq("id", id).maybeSingle();
    if (!wf) return null;
    const { data: rows } = await db
      .from("resource_permissions")
      .select("scope_type, scope_id")
      .eq("resource_type", "workflow")
      .eq("resource_id", id);
    return { id, scopes: mapResourcePermissionRowsToScopes((rows ?? []) as RawScopeRow[]) };
  },

  async checkRead(actor, row) {
    return checkAnyScopedPermission(actor, "workflow", "read", row.scopes);
  },

  async checkWrite(actor, row, action) {
    // action ∈ update / enable / duplicate / delete（builtin 路径；keys 见 WORKFLOW(_V2_NEW)_KEYS）
    return checkAnyScopedPermission(actor, "workflow", action, row.scopes);
  },

  async checkCreate(actor) {
    // workflow create 实际走路由 Lane A（按 body 的目标 scope 判）；此处仅作 facade 接口兜底：
    // actor 在自身 org / 全局是否有 create 权。
    if (await hasPermission(actor, "workflow.create.all" as PermissionKey)) return true;
    if (
      actor.tenantCode &&
      (await hasPermission(actor, "workflow.create.org" as PermissionKey, [
        { scope_type: "org", scope_id: actor.tenantCode },
      ]))
    ) {
      return true;
    }
    return false;
  },

  resolveCreateOwnership() {
    // workflow 归属写在 resource_permissions（路由负责），不在 row 注入 tenant_code
    return {};
  },
};

registerAccessAdapter(workflowAccessAdapter);
