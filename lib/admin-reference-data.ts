"use client";

export type AdminReferenceTenant = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
};

export type AdminReferenceDepartment = {
  id: string;
  name: string;
  tenant_code: string;
  sort_order: number | null;
};

export type AdminReferenceTeam = {
  id: string;
  name: string;
  dept_id: string;
  tenant_code: string | null;
  sort_order: number | null;
};

export type AdminOrgTreeData = {
  tenants: AdminReferenceTenant[];
  departments: AdminReferenceDepartment[];
  teams: AdminReferenceTeam[];
};

type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry<unknown>>();

async function loadCached<T>(
  key: string,
  loader: () => Promise<T>,
  force = false,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (!force && existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }
  if (!force && existing?.promise) return existing.promise;

  const promise = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
  return promise;
}

export function getAdminOrgTree(force = false): Promise<AdminOrgTreeData> {
  return loadCached(
    "org-tree:picker",
    async () => {
      const response = await fetch("/api/admin/org-tree?purpose=picker", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`加载组织参考数据失败（HTTP ${response.status}）`);
      }
      const payload = (await response.json()) as Partial<AdminOrgTreeData>;
      return {
        tenants: Array.isArray(payload.tenants) ? payload.tenants : [],
        departments: Array.isArray(payload.departments) ? payload.departments : [],
        teams: Array.isArray(payload.teams) ? payload.teams : [],
      };
    },
    force,
  );
}

export function invalidateAdminReferenceData(): void {
  cache.clear();
}
