// 6.4up v2 Phase D · D-0 · user resource access adapter（tenant_code + sub-action）
//
// users 表有 tenant_code（既是 actor 来源也是资源归属，不冲突）。USER_KEYS 全是 .org/.all
// （无 team/dept 粒度）→ scope 仅按 row.tenant_code 推 org/all。
// checkWrite 的 action 是复合 sub-action（由 users 路由按 body.action 映射，R0.1 §6）：
//   role.update / tenant.transfer / department.assign / team.assign / password.reset / enable / delete
//
// ⚠️ 上下级 hierarchy（canManageTarget / canAssignRole）+ "不能改自己" 仍由 users 路由现有逻辑兜，
//    本 adapter 不接管（R0.1 F1/F8）。Phase A stub 套 generic 会丢这些 sub-action / 上下级语义。
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { ResourceScope } from "@/lib/permission-actor";
import { db } from "@/lib/db";
import { scopesFromTenantCode } from "./_scope-utils";
import { checkAnyScopedPermission } from "./_generic";

type UserRow = { id: string; tenant_code: string | null };

// user key 只有 org / all 两档
const USER_SUFFIXES = ["all", "org"] as const;

function userScopes(row: UserRow): ResourceScope[] {
  return scopesFromTenantCode(row.tenant_code);
}

export const userAccessAdapter: ResourceAccessAdapter<UserRow> = {
  resourceKind: "user",

  listFilter: () => null,

  async loadDetail(id) {
    const { data } = await db.from("users").select("id, tenant_code").eq("id", id).maybeSingle();
    return (data as UserRow | null) ?? null;
  },

  async checkRead(actor, row) {
    return checkAnyScopedPermission(actor, "user", "read", userScopes(row), USER_SUFFIXES);
  },

  async checkWrite(actor, row, action) {
    // action = body.action 映射后的 sub-action（role.update / department.assign / ...）
    return checkAnyScopedPermission(actor, "user", action, userScopes(row), USER_SUFFIXES);
  },

  async checkCreate(actor) {
    // users 现状无 admin POST 创建（登录自动建）；保留接口实现，按 actor 自身 org/all 判
    return checkAnyScopedPermission(
      actor,
      "user",
      "create",
      scopesFromTenantCode(actor.tenantCode),
      USER_SUFFIXES,
    );
  },

  resolveCreateOwnership(actor) {
    return { tenant_code: actor.tenantCode };
  },
};

registerAccessAdapter(userAccessAdapter);
