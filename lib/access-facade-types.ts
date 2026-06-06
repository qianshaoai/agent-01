/**
 * 6.4up v2 Phase A R1 · access-facade 接口（纯 type-only 抽离）
 *
 * 抽离原因（R1 F3）：原本 `ResourceAccessAdapter` / `registerAccessAdapter` 都在
 * `lib/access-facade.ts`；adapter 文件 `import "@/lib/access-facade"` + facade 顶部
 * `import "./adapters/access"` 会形成 ESM 循环（partial-evaluated module）。
 *
 * R1 改用三层结构：
 *   1. `lib/access-facade-types.ts`（本文件）—— 接口 + 工具 type；纯 type-only，无 runtime side-effect
 *   2. `lib/access-registry.ts` —— REGISTRY Map + register/get 函数，依赖本文件
 *   3. `lib/access-facade.ts` —— requireAccess 业务 + 顶部 `import "./adapters/access"` 自动 bootstrap
 *
 * `@/lib/access-facade` 仍 re-export 本文件的类型 + registry 的函数，对外 API 不变。
 */

import type { PermissionActor } from "@/lib/permission-actor";

// ─── 类型 ────────────────────────────────────────────────────────

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
   *
   * 注意（R1 F4）：create 不走本方法；create 场景调 checkCreate，因为没有现成 row。
   */
  checkWrite(actor: PermissionActor, row: TRow, action: string): Promise<boolean>;

  /**
   * 6.4up v2 Phase A R1 · create 权限判定（独立接口方法，不复用 checkWrite）
   *
   * 不传 row（create 时还没 row）。adapter 内部按 `prefix.create.{scope}` permission key
   * + actor.tenantCode / payload 推导出 target scope 进行判定。
   *
   * 升为接口方法的原因（R1 F4）：原 facade create 分支调 `checkWrite(actor, null, "create")`，
   * 通用 `_generic.ts` adapter 在 `checkWrite` 里直接读 `row.tenant_code` → null row NPE。
   * 用独立方法显式区分，避免 adapter 实现时遗忘 null 分支。
   */
  checkCreate(actor: PermissionActor, payload?: Partial<TRow>): Promise<boolean>;

  /**
   * 创建时的 ownership 注入（写入 patch 前调）
   * 返回需要追加 / 覆盖的字段（如 tenant_code = actor.tenantCode）
   */
  resolveCreateOwnership(actor: PermissionActor, payload: Partial<TRow>): Partial<TRow>;
}

export type RequireAccessOpts =
  | { row: unknown }                    // 已 load row → 直接 check
  | { id: string }                      // 路由提供 id → facade 内 load → check
  | Record<string, never>;              // create / list 场景 → 仅按 actor 判定
