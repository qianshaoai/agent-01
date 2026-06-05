/**
 * 6.4up v2 Phase A · access-facade · 资源适配器 + 路由层 requireAccess
 *
 * 路由调用模板（方案 §1.5）：
 *
 *   const admin = await requireAdmin();
 *   if (admin instanceof Response) return admin;
 *   const actor = await buildPermissionActor(admin);
 *
 *   // 双闸第一道：保留 5.30up 角色白名单 fail-fast
 *   const gate = requireWriteAccess(admin, RESOURCE_WRITE_ROLES);
 *   if (gate) return gate;
 *
 *   // v2 第二道：facade 综合判定（结构性 + permission + scope）
 *   const accessErr = await requireAccess(actor, "knowledge_base", "update", { row: existing });
 *   if (accessErr) return accessErr;
 *
 *   // 业务逻辑...
 *
 * Flag 控制（方案 §3.4）：
 *   - PERMISSION_V2_ENFORCE_RESOURCES CSV 不含该 resourceKind → requireAccess 完全 no-op
 *     - 不调 adapter 任何方法（不 load、不 check）
 *     - 不读 v52 两张新表
 *     - 直接 return null
 *   - 含该 resourceKind → 调 adapter，按规则判定
 *
 * 不允许（方案 R3）：路由层直接 import hasPermission；
 *   ESLint custom rule 在后续 Phase 加，本 Phase 仅文档约束。
 */

import { PermissionActor } from "@/lib/permission-actor";
import { apiError } from "@/lib/api-error";

// ─── ResourceAccessAdapter 接口 ──────────────────────────────────

export type QueryModifier = (qb: unknown) => unknown;

export interface ResourceAccessAdapter<TRow = unknown> {
  /** 资源种类标识，与 PERMISSION_V2_ENFORCE_RESOURCES CSV 对齐 */
  resourceKind: string;

  /**
   * list filter：返回 query modifier 以供 GET list 路由 chain；null = 不限制
   * 不实现时调用方需自行处理 actor 维度可见性
   */
  listFilter(actor: PermissionActor): QueryModifier | null;

  /**
   * 按主键 load detail row，供 facade 内 PRE-check 用
   * 找不到时返回 null（不抛错），facade 转 404
   */
  loadDetail(id: string): Promise<TRow | null>;

  /** 读权限判定（结构性 + permission） */
  checkRead(actor: PermissionActor, row: TRow): Promise<boolean>;

  /**
   * 写权限判定（结构性 + permission + sub-action）
   * action 字符串：'update' / 'delete' / 'enable' / ... —— adapter 内部映射到 permission_key
   */
  checkWrite(actor: PermissionActor, row: TRow, action: string): Promise<boolean>;

  /**
   * 创建时的 ownership 注入（写入 patch 前调）
   * 返回需要追加 / 覆盖的字段（如 tenant_code = actor.tenantCode）
   */
  resolveCreateOwnership(actor: PermissionActor, payload: Partial<TRow>): Partial<TRow>;
}

// ─── adapter 注册 ────────────────────────────────────────────────

const REGISTRY = new Map<string, ResourceAccessAdapter<unknown>>();

export function registerAccessAdapter<TRow>(adapter: ResourceAccessAdapter<TRow>): void {
  REGISTRY.set(adapter.resourceKind, adapter as ResourceAccessAdapter<unknown>);
}

export function getAccessAdapter<TRow = unknown>(
  resourceKind: string,
): ResourceAccessAdapter<TRow> | null {
  return (REGISTRY.get(resourceKind) ?? null) as ResourceAccessAdapter<TRow> | null;
}

// ─── flag 解析 ───────────────────────────────────────────────────

function getEnforcedResources(): Set<string> {
  const csv = process.env.PERMISSION_V2_ENFORCE_RESOURCES ?? "";
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(parts);
}

/**
 * 当前进程是否对该 resource 启用 v2 enforce
 * 空 flag = 全部不启用 → requireAccess no-op
 */
export function isResourceEnforced(resourceKind: string): boolean {
  return getEnforcedResources().has(resourceKind);
}

// ─── requireAccess · 路由层统一闸 ────────────────────────────────

export type RequireAccessOpts =
  | { row: unknown }                    // 已 load row → 直接 check
  | { id: string }                      // 路由提供 id → facade 内 load → check
  | Record<string, never>;              // create / list 场景 → 仅按 actor 判定（不传 row 也不传 id）

/**
 * 综合判定 actor 能否对 resourceKind 执行 action
 *
 * 返回值：
 *   - null：放行（含 flag 未启用的 no-op）
 *   - Response：错误响应（403 / 404 / 500），路由直接 return
 *
 * action 语义：
 *   - 'read'：调 adapter.checkRead
 *   - 'create'：仅按 actor 判定（不需要 row），由 adapter.checkWrite 配合 action='create' 实现
 *     [本 Phase 简化：create 场景 facade 仅检 flag + actor 是否 super；具体 ownership 在 resolveCreateOwnership 处理]
 *   - 其它（'update' / 'delete' / 'enable' / 子动作）：调 adapter.checkWrite
 */
export async function requireAccess(
  actor: PermissionActor,
  resourceKind: string,
  action: string,
  opts: RequireAccessOpts = {},
): Promise<Response | null> {
  // ─── flag gate：未启用该 resource → 完全 no-op ─────────────────
  if (!isResourceEnforced(resourceKind)) return null;

  // super_admin 公式第 1 行硬全权
  if (actor.builtinRole === "super_admin") return null;

  // ─── adapter 查找 ──────────────────────────────────────────────
  const adapter = getAccessAdapter(resourceKind);
  if (!adapter) {
    // flag 列出了一个 resource 但 adapter 没注册 → 视为配置错误，500
    console.error(`[requireAccess] adapter not registered for resource: ${resourceKind}`);
    return apiError("权限校验未就绪", "INTERNAL_ERROR");
  }

  // ─── 拿 row（如 opts.row 已提供则复用，否则按 id load） ────────
  let row: unknown = null;
  if ("row" in opts && opts.row !== undefined) {
    row = opts.row;
  } else if ("id" in opts && opts.id) {
    try {
      row = await adapter.loadDetail(opts.id);
    } catch (e) {
      console.error(`[requireAccess] adapter.loadDetail threw for ${resourceKind}/${opts.id}`, e);
      return apiError("权限校验失败", "INTERNAL_ERROR");
    }
    if (row === null) {
      // 404 屏蔽：拿不到 row 时一律 NOT_FOUND（避免越权探测）
      return apiError("资源不存在", "NOT_FOUND");
    }
  }

  // ─── 调 adapter check ─────────────────────────────────────────
  try {
    if (action === "read") {
      if (row === null) {
        // read 但无 row 不合规 → fail-closed
        return apiError("权限不足", "FORBIDDEN");
      }
      const ok = await adapter.checkRead(actor, row);
      if (!ok) return apiError("权限不足", "FORBIDDEN");
      return null;
    }

    if (action === "create") {
      // create 场景：facade 仅按 actor 判定有无 .{scope}.create.* 权限；
      // adapter 在 resolveCreateOwnership 时注入归属字段。
      // 本 Phase 简化：调 adapter.checkWrite 传 row=null（adapter 内部处理 null row 的 create 语义）
      const ok = await adapter.checkWrite(actor, row as never, action);
      if (!ok) return apiError("权限不足", "FORBIDDEN");
      return null;
    }

    // 写操作（update / delete / enable / 子动作）
    if (row === null) {
      // 写操作但既没 row 也没 id → fail-closed
      return apiError("权限校验缺少资源上下文", "INTERNAL_ERROR");
    }
    const ok = await adapter.checkWrite(actor, row, action);
    if (!ok) return apiError("权限不足", "FORBIDDEN");
    return null;
  } catch (e) {
    // 方案 §6 R11：facade 内部统一 try/catch；adapter throw → 500（不假装 403）
    console.error(`[requireAccess] adapter check threw for ${resourceKind}/${action}`, e);
    return apiError("权限校验失败", "INTERNAL_ERROR");
  }
}
