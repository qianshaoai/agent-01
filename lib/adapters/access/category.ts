// 6.4up v2 Phase A · category resource access adapter (platform-level)
import { buildPlatformAdapter } from "./_generic";

export const categoryAccessAdapter = buildPlatformAdapter({
  resourceKind: "category",
  table: "categories",
  permissionPrefix: "category",
});
