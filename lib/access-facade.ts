/**
 * 6.4up v2 Phase A · access-facade · 资源适配器 + 路由层 requireAccess
 *
 * R1 改造（2026-06-06）：
 *   - F3：REGISTRY + register/get 拆到 `lib/access-registry.ts`；接口 + opts 拆到
 *         `lib/access-facade-types.ts`。本文件**顶部 import "./adapters/access"**
 *         自动 bootstrap 13 个 adapter 注册，consumer 路由无需额外 import。
 *   - F4：requireAccess create 分支改调 `adapter.checkCreate(actor)` 替代
 *         `adapter.checkWrite(actor, null as never, "create")`，与新增的
 *         `ResourceAccessAdapter.checkCreate` 接口方法对应。
 *
 * 对外 API 保持不变：
 *   - 旧 `import { requireAccess, registerAccessAdapter, getAccessAdapter,
 *           type ResourceAccessAdapter, type QueryModifier } from "@/lib/access-facade"`
 *     全部 re-export，无破坏性。
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
 * Flag 控制（方案 §3.4）：
 *   - PERMISSION_V2_ENFORCE_RESOURCES CSV 不含该 resourceKind → requireAccess 完全 no-op
 *     - 不调 adapter 任何方法（不 load、不 check）
 *     - 不读 v52 两张新表
 *     - 直接 return null
 *   - 含该 resourceKind → 调 adapter，按规则判定
 */

// ─── 自动 bootstrap adapter REGISTRY（R1 F3）─────────────────────
// 仅靠 side-effect import：13 个 adapter 文件在加载时调 registerAccessAdapter
// 注册到 lib/access-registry.ts 的 REGISTRY。任何文件 import `@/lib/access-facade`
// 都会触发本 import → REGISTRY 已就绪 → requireAccess 不会再撞空 registry 500。
import "./adapters/access";

import { PermissionActor } from "@/lib/permission-actor";
import { apiError } from "@/lib/api-error";
import { getAccessAdapter } from "@/lib/access-registry";

// ─── 对外 re-export（保持 @/lib/access-facade API 不变）──────────

export {
  registerAccessAdapter,
  getAccessAdapter,
} from "@/lib/access-registry";

export type {
  ResourceAccessAdapter,
  QueryModifier,
  RequireAccessOpts,
} from "@/lib/access-facade-types";

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

/**
 * 综合判定 actor 能否对 resourceKind 执行 action
 *
 * 返回值：
 *   - null：放行（含 flag 未启用的 no-op）
 *   - Response：错误响应（403 / 404 / 500），路由直接 return
 *
 * action 语义：
 *   - 'read'：调 adapter.checkRead（需 row）
 *   - 'create'：调 adapter.checkCreate（R1 F4，不需要 row）
 *   - 其它（'update' / 'delete' / 'enable' / 子动作）：调 adapter.checkWrite（需 row）
 */
export async function requireAccess(
  actor: PermissionActor,
  resourceKind: string,
  action: string,
  opts: import("@/lib/access-facade-types").RequireAccessOpts = {},
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

  // ─── create 分支（R1 F4）：不需要 row，直接调 checkCreate ──────
  if (action === "create") {
    try {
      const ok = await adapter.checkCreate(actor);
      if (!ok) return apiError("权限不足", "FORBIDDEN");
      return null;
    } catch (e) {
      console.error(`[requireAccess] adapter.checkCreate threw for ${resourceKind}`, e);
      return apiError("权限校验失败", "INTERNAL_ERROR");
    }
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

  // ─── 调 adapter check（read / 写动作）─────────────────────────
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
