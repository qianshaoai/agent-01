// 5.30up · 组织级 ownership 共用工具
//
// 来源：upgrade/5.30up/方案-org_admin-API+KB管理权限-20260529.md（R2 通过）
//
// 核心模型：
//   - 资源（model_providers / knowledge_bases）行上的 `tenant_code` 表达归属：
//     - NULL    → 平台公共（super/system 建）。全员可见；仅 super/system 可写
//     - "ORG-X" → 组织建。super/system + 该 org admin 可见；super/system + 该 org_admin 可写
//   - 5 个核心同步 helper + 1 个 async tenants 存在性校验 + 1 个 async 引用扫描 +
//     1 个路由层写访问总闸门
//
// R2 §1 · 双闸模型：
//   `canWriteRow` **只判归属**，不判角色白名单。每个写路由顶部用 `requireWriteAccess`
//   做"角色白名单 + 缺 tenantCode 兜底"，再 load row 后调 `canWriteRow` 判归属。两道都过才放行。
//
// R2 §2 · org_admin 缺 tenantCode 全部 fail-closed：
//   `getActiveAdmin()` 只从 admins/users 读 tenant_code，缺失即意味着账号配置异常。
//   5 个核心 helper + requireWriteAccess + listScopeFilter 七处全部拒。
//
// R2 §6 · validateTenantCode 拆 async：
//   核心 5 函数保持纯同步可测；DB 查询单独拆出来路由层显式 await。

import { AdminPayload, AdminRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";

export type ScopedResource = { tenant_code: string | null };

/** scanReferences 用——扫描资源的引用面 */
export type ScopedResourceKind = "model_provider" | "knowledge_base";

/**
 * `applyListScope` 的输出形态：用 `.or()` filter string 返回，让 route 显式 apply 到 query。
 * 这样 helper 完全 pure（不依赖 Supabase QueryBuilder 泛型），更可测、更可读。
 *
 * - super / system → null（无需 scope）
 * - org_admin + 有 tenantCode → "tenant_code.is.null,tenant_code.eq.<X>"
 * - org_admin + 缺 tenantCode → IMPOSSIBLE_FILTER（fail-closed；route 仍应被 requireReadAccess 拦在前面）
 */
const IMPOSSIBLE_FILTER = "id.eq.00000000-0000-0000-0000-000000000000";

/**
 * 6.6up Fix · 「平台公共(tenant_code=NULL) + 本组织」列表过滤串（单一口径来源）。
 *   builtin 通道（listScopeFilter）与 custom/v2 角色的列表分支共用，避免 v2 通道漏掉
 *   平台公共资源（kb / provider / notice 的 custom 列表分支原本只 `.eq(本组织)` → 漏公共）。
 *   Supabase .or() 不接受双引号 / 复杂转义；tenantCode 已是 [a-zA-Z0-9_-] 形态。
 *   Route 用法：query = query.or(tenantPublicOrOwnFilter(tenantCode));
 */
export function tenantPublicOrOwnFilter(tenantCode: string): string {
  return `tenant_code.is.null,tenant_code.eq.${tenantCode}`;
}

/**
 * GET list 时的 ownership 过滤字符串。
 * Route 用法：
 *   const scope = listScopeFilter(admin);
 *   if (scope) query = query.or(scope);
 */
export function listScopeFilter(admin: AdminPayload): string | null {
  if (admin.role === "super_admin" || admin.role === "system_admin") return null;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return IMPOSSIBLE_FILTER; // R2 §2 fail-closed
    return tenantPublicOrOwnFilter(admin.tenantCode);
  }
  return IMPOSSIBLE_FILTER;
}

/**
 * GET detail / 写操作前的读权限判定。仅判归属。
 * super/system 永远 true；org_admin 看公共 + 自己 org；org_admin 缺 tenantCode → false。
 */
export function canReadRow(admin: AdminPayload, row: ScopedResource): boolean {
  if (admin.role === "super_admin" || admin.role === "system_admin") return true;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return false; // R2 §2
    return row.tenant_code === null || row.tenant_code === admin.tenantCode;
  }
  return false;
}

/**
 * PATCH / DELETE 前的写归属判定。**只判归属**（R2 §1 双闸：角色白名单由 requireWriteAccess 做）。
 * super/system → true；org_admin → 仅 own（排 NULL = 不让 org 改平台公共）。
 */
export function canWriteRow(admin: AdminPayload, row: ScopedResource): boolean {
  if (admin.role === "super_admin" || admin.role === "system_admin") return true;
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return false; // R2 §2
    return row.tenant_code === admin.tenantCode;
  }
  return false;
}

/**
 * 错误：org_admin 缺 tenantCode 时被路由直接调 resolveCreateOwnership。
 * 实际部署中 requireWriteAccess 已先拦截；这是兜底防御。
 */
export class ScopeAdminNoTenantError extends Error {
  code = "SCOPE_ADMIN_NO_TENANT";
  constructor() {
    super("组织管理员未绑定组织，无法创建资源");
  }
}

/**
 * POST 创建时强制注入 tenant_code。
 *   - super/system → 沿用 payload（可指定 tenant_code 或 NULL，调用方 await validateTenantCode）
 *   - org_admin → 强制为 admin.tenantCode（防越权）
 *   - org_admin + 缺 tenantCode → throw ScopeAdminNoTenantError（兜底）
 */
export function resolveCreateOwnership(
  admin: AdminPayload,
  payload: { tenant_code?: string | null }
): { tenant_code: string | null } {
  if (admin.role === "super_admin" || admin.role === "system_admin") {
    const tc = payload.tenant_code;
    if (typeof tc === "string" && tc.trim() !== "") return { tenant_code: tc.trim() };
    return { tenant_code: null };
  }
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) throw new ScopeAdminNoTenantError();
    return { tenant_code: admin.tenantCode };
  }
  throw new ScopeAdminNoTenantError(); // 防御未来新增 role
}

/**
 * PATCH 时净化 patch 字段。
 *   - super/system → patch 不动（若改了 tenant_code，调用方需 await validateTenantCode + scanReferences）
 *   - org_admin → 剥离 `tenant_code` 字段（防把自己资源转给别 org / 改成 NULL）
 *
 * 返回**新对象**而非原地改（避免污染调用方 payload）。
 */
export function sanitizeUpdatePatch(
  admin: AdminPayload,
  patch: Record<string, unknown>
): Record<string, unknown> {
  if (admin.role === "super_admin" || admin.role === "system_admin") return { ...patch };
  if (admin.role === "org_admin") {
    const { tenant_code: _stripped, ...rest } = patch;
    void _stripped;
    return rest;
  }
  return {};
}

// ─── R2 §6 · validateTenantCode（async） ───────────────────────────────────

/**
 * 查 `tenants.code` 存在。空串 / null / undefined 直接 false。
 * super/system 显式赋资源给某 org 时路由层先 await 它；不存在 → 422
 * org_admin 创建资源时调一次（防 admin.tenantCode 指向已删 org）→ 不存在 → 403
 */
export async function validateTenantCode(code: string | null | undefined): Promise<boolean> {
  if (!code || typeof code !== "string" || code.trim() === "") return false;
  const { data, error } = await db
    .from("tenants")
    .select("code")
    .eq("code", code.trim())
    .maybeSingle();
  if (error) {
    console.error("[scoped-access] validateTenantCode failed:", error);
    return false; // fail-closed
  }
  return !!data;
}

// ─── R2 §4 · scanReferences（async） ───────────────────────────────────────
// 转让 tenant_code（PATCH）和 DELETE 共用同一扫描函数。"转让 = 必须零引用"模式。

export type ScanReferencesResult = {
  totalCount: number;
  /** 用于错误消息：["agents 3 个", "agent_drafts 2 个"] */
  byPlace: string[];
};

/**
 * 扫描资源的所有引用面，返回总计数 + 分项说明。
 *   - model_provider：扫 agents.provider_id + agent_drafts.provider_id（两表都有 _provider_id_idx 索引）
 *   - knowledge_base：扫 agent_knowledge_bases.kb_id + agent_drafts.builder_config.knowledge_base_ids JSON
 *
 * 注：JSON 字段无 GIN 索引，转让/删 KB 是低频操作，扫一次 O(N) 可接受（小B R1 §6 + R2 三审认）。
 */
export async function scanReferences(
  kind: ScopedResourceKind,
  resourceId: string
): Promise<ScanReferencesResult> {
  const byPlace: string[] = [];
  let totalCount = 0;

  if (kind === "model_provider") {
    const { count: ac, error: ae } = await db
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", resourceId);
    if (ae) throw new Error(`scanReferences agents 查询失败：${ae.message}`);
    if (ac && ac > 0) {
      byPlace.push(`已发布智能体 ${ac} 个`);
      totalCount += ac;
    }

    const { count: dc, error: de } = await db
      .from("agent_drafts")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", resourceId);
    if (de) throw new Error(`scanReferences agent_drafts 查询失败：${de.message}`);
    if (dc && dc > 0) {
      byPlace.push(`智能体草稿 ${dc} 个`);
      totalCount += dc;
    }
  } else if (kind === "knowledge_base") {
    const { count: kc, error: ke } = await db
      .from("agent_knowledge_bases")
      .select("agent_id", { count: "exact", head: true })
      .eq("kb_id", resourceId);
    if (ke) throw new Error(`scanReferences agent_knowledge_bases 查询失败：${ke.message}`);
    if (kc && kc > 0) {
      byPlace.push(`已发布智能体 ${kc} 个`);
      totalCount += kc;
    }

    // 草稿里的 KB 引用藏在 builder_config.knowledge_base_ids JSON 数组里
    // Supabase .contains() 走 PostgreSQL `@>`：builder_config @> '{"knowledge_base_ids":["<id>"]}'
    const { count: dc, error: de } = await db
      .from("agent_drafts")
      .select("id", { count: "exact", head: true })
      .contains("builder_config", { knowledge_base_ids: [resourceId] });
    if (de) throw new Error(`scanReferences agent_drafts JSON 查询失败：${de.message}`);
    if (dc && dc > 0) {
      byPlace.push(`智能体草稿 ${dc} 个`);
      totalCount += dc;
    }
  }

  return { totalCount, byPlace };
}

// ─── R2 §1 · requireWriteAccess（路由层双闸总闸门） ────────────────────────

/**
 * 路由层在 requireAdmin 之后立刻调，做：
 *   1. 角色白名单（API 写默认排 system_admin；KB 写不排，由 allowedRoles 显式指定）
 *   2. org_admin 缺 tenantCode 兜底（与 helper 内的 fail-closed 双重防线）
 *
 * 用法：
 *   const gate = requireWriteAccess(admin, ["super_admin", "org_admin"]);
 *   if (gate) return gate;
 *
 * 后续仍需：load row → canWriteRow(admin, row) → 操作。
 */
export function requireWriteAccess(
  admin: AdminPayload,
  allowedRoles: AdminRole[]
): NextResponse | null {
  if (!allowedRoles.includes(admin.role)) {
    return apiError("无权操作该资源", "FORBIDDEN");
  }
  if (admin.role === "org_admin" && !admin.tenantCode) {
    return apiError("组织管理员未绑定组织，无法操作；请联系平台管理员", "FORBIDDEN");
  }
  return null;
}
