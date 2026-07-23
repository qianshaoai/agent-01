/**
 * 6.4up v2 Phase D · D-0 · resource_permissions 行 → ResourceScope[] 纯映射
 *
 * 本文件**不 import db / 不 import permission-actor 的 runtime**（仅 `import type`），
 * 因此可被 tsx 单测在无 Supabase env 时直接 import（见 scripts/phase-d-scope-utils.test.ts）。
 *
 * workflow / agent 的归属来源是 resource_permissions（5.8up，migration_v8），不是 tenant_code 列。
 * resource_permissions.scope_type ∈ all/org/dept/team/user/user_type；
 * 但 hasPermission 的 ResourceScope 只认 all/org/dept/team。映射时**必须丢弃 user / user_type**
 * （那是"资源对哪些用户可见"的维度，不参与 admin 权限的 scope 判定）。漏过滤 = 越权风险。
 */

import type { ResourceScope } from "@/lib/permission-actor";

export type RawScopeRow = { scope_type: string; scope_id: string | null };

/**
 * 把 resource_permissions 查询行映射成 hasPermission 用的 ResourceScope[]。
 * 仅保留 all/org/dept/team；user / user_type / 任何未知值一律丢弃（fail-closed，不当成 all）。
 * all 行的 scope_id 归一为 null。
 */
export function mapResourcePermissionRowsToScopes(
  rows: RawScopeRow[],
): ResourceScope[] {
  const out: ResourceScope[] = [];
  for (const r of rows) {
    if (r.scope_type === "all") {
      out.push({ scope_type: "all", scope_id: null });
    } else if (
      r.scope_type === "org" ||
      r.scope_type === "dept" ||
      r.scope_type === "team"
    ) {
      out.push({ scope_type: r.scope_type, scope_id: r.scope_id });
    }
    // user / user_type / 未知 → 丢弃
  }
  return out;
}

/**
 * tenant_code → ResourceScope[]：有 tenant_code 视为 org scope，否则视为 all（平台级）。
 * 给 agent_draft（反查 created_by 的 users.tenant_code）/ user 等 tenant-owned 资源复用，
 * 语义与 _generic.ts 的 scopesFromTenantRow 一致，抽到无 db 模块以便单测与共享。
 */
export function scopesFromTenantCode(
  tenantCode: string | null | undefined,
): ResourceScope[] {
  return tenantCode
    ? [{ scope_type: "org", scope_id: tenantCode }]
    : [{ scope_type: "all", scope_id: null }];
}

/**
 * 草稿创建者 UUID 可能同时存在于 admins / users。
 * 与单条 resolver 的 nullish fallback 保持一致：admin 非空优先；
 * admin 行存在但 tenant 为空时继续使用 user tenant，避免误扩大为 all。
 */
export function coalesceAdminUserTenantCode(
  adminTenantCode: string | null | undefined,
  userTenantCode: string | null | undefined,
): string | null {
  return adminTenantCode ?? userTenantCode ?? null;
}

/**
 * 6.4up v2 Phase D · D-3 Fix · workflow 复制时挑选要克隆给副本的 resource_permissions 行。
 *
 * 背景：duplicate 原本只复制 workflow + steps + categories，漏了 resource_permissions →
 *   副本零归属行。org_admin 列表按 resource_permissions 命中本组织过滤（5.9up 既有逻辑，
 *   不受 enforce 开关控制），副本零行 → 刷新后从自己列表"消失"；且 workflow enforce 开启后
 *   adapter 反查归属也判不到。故 insert 副本后需把源行按角色克隆过来。
 *
 * 规则（与 duplicate 守卫同口径）：
 *   - super_admin / system_admin：原样克隆**全部** scope 行（含 all/user/user_type，精确复制源可见性）。
 *   - org_admin：只保留命中**本组织**的行——org(scope_id==tenantCode) / dept(∈orgDeptIds) /
 *     team(∈orgTeamIds)；all、user、user_type、跨组织 dept/team 一律丢弃（归一到本组织范围）。
 *     duplicate 守卫已保证源至少有一条本组织命中行，故过滤结果非空。
 *
 * 纯函数：dept/team 归属集由调用方先查好传入，本模块不碰 db（保持可单测）。
 */
export function selectDuplicatePermRows(
  srcRows: RawScopeRow[],
  opts: {
    role: "super_admin" | "system_admin" | "org_admin";
    tenantCode: string | null;
    orgDeptIds: Set<string>;
    orgTeamIds: Set<string>;
  },
): RawScopeRow[] {
  if (opts.role !== "org_admin") {
    // super / system：精确克隆全部行
    return srcRows.map((r) => ({ scope_type: r.scope_type, scope_id: r.scope_id }));
  }
  const out: RawScopeRow[] = [];
  for (const r of srcRows) {
    if (r.scope_type === "org" && r.scope_id !== null && r.scope_id === opts.tenantCode) {
      out.push({ scope_type: "org", scope_id: r.scope_id });
    } else if (r.scope_type === "dept" && r.scope_id !== null && opts.orgDeptIds.has(r.scope_id)) {
      out.push({ scope_type: "dept", scope_id: r.scope_id });
    } else if (r.scope_type === "team" && r.scope_id !== null && opts.orgTeamIds.has(r.scope_id)) {
      out.push({ scope_type: "team", scope_id: r.scope_id });
    }
    // all / user / user_type / 跨组织 dept|team / 未知 → 丢弃
  }
  return out;
}
