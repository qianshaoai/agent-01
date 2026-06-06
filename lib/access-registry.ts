/**
 * 6.4up v2 Phase A R1 · access-facade adapter REGISTRY（独立模块）
 *
 * 拆分原因（R1 F3）：原 REGISTRY 与 register/get 在 `lib/access-facade.ts`，
 * adapter 文件 import facade + facade 顶部 import adapters 形成 ESM 循环。
 * 拆到独立模块后：adapter 文件依赖本模块，facade 也依赖本模块，无循环。
 *
 * `@/lib/access-facade` 仍 re-export 本模块的两个函数，对外 API 不变。
 */

import type { ResourceAccessAdapter } from "@/lib/access-facade-types";

const REGISTRY = new Map<string, ResourceAccessAdapter<unknown>>();

export function registerAccessAdapter<TRow>(adapter: ResourceAccessAdapter<TRow>): void {
  REGISTRY.set(adapter.resourceKind, adapter as ResourceAccessAdapter<unknown>);
}

export function getAccessAdapter<TRow = unknown>(
  resourceKind: string,
): ResourceAccessAdapter<TRow> | null {
  return (REGISTRY.get(resourceKind) ?? null) as ResourceAccessAdapter<TRow> | null;
}
