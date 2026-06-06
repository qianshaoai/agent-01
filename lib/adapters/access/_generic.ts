/**
 * 6.4up v2 Phase A · 通用 ResourceAccessAdapter 构造器
 *
 * 对于"tenant_code ownership"模式的 resource（kb / notice / provider / dept / team 等）
 * 用 buildTenantOwnedAdapter 一行注册。
 * 特殊路径（workflow 走 resource_permissions / agent 走 tenant_agents / user 走 5.11up
 * 上下级 / agent_draft 走 created_by 反查）单独写 adapter。
 *
 * R1（2026-06-06）：
 *   - F3：import 改自 access-registry / access-facade-types，断开 facade 循环
 *   - F4：buildTenantOwnedAdapter / buildPlatformAdapter 都补 checkCreate 实现，
 *         不再让 facade 把 row=null 喂给 checkWrite
 *
 * 本 Phase 是骨架版：checkRead/checkWrite 内部委托给 hasPermission，行为完全等价
 * 6.4up（hasPermission builtin path 在 v2Loaded=false 时退回旧 role-based fallback）。
 * Phase C-E enforce 启用时由 builtin_role_permissions seed 驱动，无需改 adapter。
 */

import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";
import { hasPermission, PermissionActor, ResourceScope } from "@/lib/permission-actor";
import { db } from "@/lib/db";
import { PermissionKey } from "@/lib/permission-keys";

export type TenantOwnedRow = { id: string; tenant_code?: string | null };

function scopesFromTenantRow(row: TenantOwnedRow): ResourceScope[] {
  return row.tenant_code
    ? [{ scope_type: "org", scope_id: row.tenant_code }]
    : [{ scope_type: "all", scope_id: null }];
}

export function buildTenantOwnedAdapter(config: {
  resourceKind: string;
  table: string;
  permissionPrefix: string; // 例 "kb" / "notice" / "provider"
  readAction?: string;       // 默认 "read"
}): ResourceAccessAdapter<TenantOwnedRow> {
  const readAct = config.readAction ?? "read";
  const adapter: ResourceAccessAdapter<TenantOwnedRow> = {
    resourceKind: config.resourceKind,

    // list filter 不做收紧：route 层旧逻辑保留，facade 仅叠加 row 级判定
    listFilter: () => null,

    async loadDetail(id) {
      const { data } = await db
        .from(config.table)
        .select("id, tenant_code")
        .eq("id", id)
        .maybeSingle();
      return (data as TenantOwnedRow | null) ?? null;
    },

    async checkRead(actor, row) {
      const scope: "org" | "all" = row.tenant_code ? "org" : "all";
      const key = `${config.permissionPrefix}.${readAct}.${scope}` as PermissionKey;
      return await hasPermission(actor, key, scopesFromTenantRow(row));
    },

    async checkWrite(actor, row, action) {
      const scope: "org" | "all" = row.tenant_code ? "org" : "all";
      const key = `${config.permissionPrefix}.${action}.${scope}` as PermissionKey;
      return await hasPermission(actor, key, scopesFromTenantRow(row));
    },

    /**
     * R1 F4 · create 不传 row：actor 必须有 tenantCode（个人 admin 无 tenant 不允许在
     * org-scope 内建 tenant-owned 资源；future enforce 时如需"平台级建"路径，单独 adapter）
     */
    async checkCreate(actor) {
      if (!actor.tenantCode) return false;
      const key = `${config.permissionPrefix}.create.org` as PermissionKey;
      return await hasPermission(actor, key, [
        { scope_type: "org", scope_id: actor.tenantCode },
      ]);
    },

    resolveCreateOwnership(actor): Partial<TenantOwnedRow> {
      // 默认：注入 actor 的 tenantCode；adapter 调用方可手动 override
      return { tenant_code: actor.tenantCode };
    },
  };
  registerAccessAdapter(adapter);
  return adapter;
}

/**
 * platform-level（无 tenant）adapter helper：tenant / setting / category
 * 这类资源只有 .all scope
 */
export function buildPlatformAdapter(config: {
  resourceKind: string;
  table: string;
  permissionPrefix: string;
  readAction?: string;
}): ResourceAccessAdapter<{ id: string }> {
  const readAct = config.readAction ?? "read";
  const adapter: ResourceAccessAdapter<{ id: string }> = {
    resourceKind: config.resourceKind,
    listFilter: () => null,
    async loadDetail(id) {
      const { data } = await db.from(config.table).select("id").eq("id", id).maybeSingle();
      return data ?? null;
    },
    async checkRead(actor) {
      const key = `${config.permissionPrefix}.${readAct}.all` as PermissionKey;
      return await hasPermission(actor, key);
    },
    async checkWrite(actor, _row, action) {
      void _row;
      const key = `${config.permissionPrefix}.${action}.all` as PermissionKey;
      return await hasPermission(actor, key);
    },
    /** R1 F4 · platform-level create 用 .all 后缀 */
    async checkCreate(actor) {
      const key = `${config.permissionPrefix}.create.all` as PermissionKey;
      return await hasPermission(actor, key);
    },
    resolveCreateOwnership() {
      return {};
    },
  };
  registerAccessAdapter(adapter);
  return adapter;
}

// 让 imports 拿到引用以便 dev 调试，但本 Phase 不显式用
export type { PermissionActor };
