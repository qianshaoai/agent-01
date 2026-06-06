// 6.4up v2 Phase A · setting resource access adapter (super-only)
//
// 与其他 adapter 不同：setting 不入 builtin_role_permissions seed
// （方案 §3.2 + 验收 #7：非 super 即使被 grant setting.* 也不允许；API + UI 双层禁止）。
// hasPermission 公式第 1 行 super_admin 硬全权已覆盖；非 super actor 走到 checkRead/checkWrite/checkCreate
// 直接拒（permission key 不在 effective set / 旧 fallback 也不放）。
//
// R1（2026-06-06）：
//   - F3：import 改自 access-registry / access-facade-types（避免 facade 循环）
//   - F4：补 checkCreate（super 已在 facade 顶部放行；这里到达即非 super → false）
import type { ResourceAccessAdapter } from "@/lib/access-facade-types";
import { registerAccessAdapter } from "@/lib/access-registry";

export const settingAccessAdapter: ResourceAccessAdapter<{ id: string }> = {
  resourceKind: "setting",
  listFilter: () => null,
  async loadDetail() {
    // setting 不按 id 检索（全局 K/V），返回 placeholder 让 facade 不抛 NOT_FOUND
    return { id: "_global" };
  },
  async checkRead(actor) {
    // super 已在 requireAccess 公式第 1 行放行；这里只剩非 super → fail-closed
    return actor.builtinRole === "super_admin";
  },
  async checkWrite(actor) {
    return actor.builtinRole === "super_admin";
  },
  async checkCreate(actor) {
    return actor.builtinRole === "super_admin";
  },
  resolveCreateOwnership() {
    return {};
  },
};

registerAccessAdapter(settingAccessAdapter);
