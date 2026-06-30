"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Globe2,
  Loader2,
  Search,
  Users,
} from "lucide-react";

export type KbVisibilityScope = {
  scope_type: "all" | "org" | "dept" | "team";
  scope_id: string | null;
};

export type VisibilityTeam = { id: string; name: string; dept_id: string };
export type VisibilityDept = {
  id: string;
  name: string;
  tenant_code: string;
  teams: VisibilityTeam[];
};
export type VisibilityTenant = {
  code: string;
  name: string;
  enabled: boolean;
  departments: VisibilityDept[];
};

export const DEFAULT_KB_VISIBILITY: KbVisibilityScope[] = [{ scope_type: "all", scope_id: null }];

export function kbVisibilityScopeKey(scope: KbVisibilityScope) {
  return `${scope.scope_type}:${scope.scope_id ?? ""}`;
}

export function normalizeKbVisibilityScopes(value: unknown): KbVisibilityScope[] {
  if (!Array.isArray(value)) return DEFAULT_KB_VISIBILITY;
  const scopes: KbVisibilityScope[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { scope_type?: unknown; scope_id?: unknown };
    const scope: KbVisibilityScope | null =
      raw.scope_type === "all"
        ? { scope_type: "all", scope_id: null }
        : raw.scope_type === "org" || raw.scope_type === "dept" || raw.scope_type === "team"
          ? typeof raw.scope_id === "string" && raw.scope_id
            ? { scope_type: raw.scope_type, scope_id: raw.scope_id }
            : null
          : null;
    if (!scope) continue;
    const key = kbVisibilityScopeKey(scope);
    if (!seen.has(key)) {
      seen.add(key);
      scopes.push(scope);
    }
  }
  return scopes.length > 0 ? scopes : DEFAULT_KB_VISIBILITY;
}

export function findKbVisibilityName(tree: VisibilityTenant[], scope: KbVisibilityScope) {
  if (scope.scope_type === "all") return "全部可见";
  if (!scope.scope_id) return "";
  for (const tenant of tree) {
    if (scope.scope_type === "org" && tenant.code === scope.scope_id) {
      return tenant.name || tenant.code;
    }
    for (const dept of tenant.departments) {
      if (scope.scope_type === "dept" && dept.id === scope.scope_id) return dept.name;
      const team = dept.teams.find((item) => item.id === scope.scope_id);
      if (scope.scope_type === "team" && team) return team.name;
    }
  }
  return scope.scope_id;
}

export function summarizeKbVisibility(scopes: KbVisibilityScope[], tree: VisibilityTenant[]) {
  if (scopes.length === 1 && scopes[0]?.scope_type === "all") return "全部可见";
  const labels = scopes.map((scope) => {
    const prefix = scope.scope_type === "org" ? "组织" : scope.scope_type === "dept" ? "部门" : "小组";
    return `${prefix}: ${findKbVisibilityName(tree, scope)}`;
  });
  if (labels.length <= 2) return labels.join("，");
  return `${labels.slice(0, 2).join("，")} 等 ${labels.length} 个范围`;
}

export function KbVisibilityScopeEditor({
  mode,
  scopes,
  scopeKeys,
  tree,
  canUseAll,
  loading,
  onModeChange,
  onToggleScope,
}: {
  mode: "all" | "custom";
  scopes: KbVisibilityScope[];
  scopeKeys: Set<string>;
  tree: VisibilityTenant[];
  canUseAll: boolean;
  loading: boolean;
  onModeChange: (mode: "all" | "custom") => void;
  onToggleScope: (scope: KbVisibilityScope) => void;
}) {
  const [scopeSearch, setScopeSearch] = useState("");
  const [expandedTenants, setExpandedTenants] = useState<Set<string>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const searchText = scopeSearch.trim().toLowerCase();

  const filteredTree = useMemo(() => {
    if (!searchText) return tree;

    const includes = (value: string | null | undefined) => (value ?? "").toLowerCase().includes(searchText);

    return tree
      .map((tenant) => {
        const tenantMatched = includes(tenant.name) || includes(tenant.code);
        if (tenantMatched) return tenant;

        const departments = tenant.departments
          .map((dept) => {
            const deptMatched = includes(dept.name) || includes(dept.id);
            const teams = dept.teams.filter((team) => includes(team.name) || includes(team.id));
            if (deptMatched) return dept;
            if (teams.length > 0) return { ...dept, teams };
            return null;
          })
          .filter((dept): dept is VisibilityDept => dept !== null);

        return departments.length > 0 ? { ...tenant, departments } : null;
      })
      .filter((tenant): tenant is VisibilityTenant => tenant !== null);
  }, [searchText, tree]);

  const autoExpandedTenantIds = useMemo(
    () => new Set(searchText ? filteredTree.map((tenant) => tenant.code) : []),
    [filteredTree, searchText],
  );
  const autoExpandedDeptIds = useMemo(() => {
    const ids = new Set<string>();
    if (!searchText) return ids;
    for (const tenant of filteredTree) {
      for (const dept of tenant.departments) ids.add(dept.id);
    }
    return ids;
  }, [filteredTree, searchText]);
  const selectedExpanded = useMemo(() => {
    const tenants = new Set<string>();
    const depts = new Set<string>();
    for (const tenant of tree) {
      for (const dept of tenant.departments) {
        if (scopeKeys.has(kbVisibilityScopeKey({ scope_type: "dept", scope_id: dept.id }))) {
          tenants.add(tenant.code);
        }
        for (const team of dept.teams) {
          if (scopeKeys.has(kbVisibilityScopeKey({ scope_type: "team", scope_id: team.id }))) {
            tenants.add(tenant.code);
            depts.add(dept.id);
          }
        }
      }
    }
    return { tenants, depts };
  }, [scopeKeys, tree]);

  function toggleTenant(tenantCode: string) {
    setExpandedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(tenantCode)) next.delete(tenantCode);
      else next.add(tenantCode);
      return next;
    });
  }

  function toggleDept(deptId: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canUseAll}
          onClick={() => onModeChange("all")}
          className={`flex h-10 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
            mode === "all"
              ? "border-[#002FA7] bg-[#edf3ff] text-[#002FA7]"
              : "border-gray-200 bg-white text-gray-700 hover:border-[#002FA7]/30"
          }`}
        >
          <Globe2 size={15} />
          全部可见
        </button>
        <button
          type="button"
          onClick={() => onModeChange("custom")}
          className={`flex h-10 items-center justify-center gap-2 rounded-[10px] border text-sm font-medium transition ${
            mode === "custom"
              ? "border-[#002FA7] bg-[#edf3ff] text-[#002FA7]"
              : "border-gray-200 bg-white text-gray-700 hover:border-[#002FA7]/30"
          }`}
        >
          <Building2 size={15} />
          指定范围
        </button>
      </div>
      {!canUseAll && (
        <p className="text-xs leading-5 text-gray-500">
          当前账号不能设置全平台可见，可在授权范围内选择组织、部门或小组。
        </p>
      )}
      {mode === "custom" && (
        <div className="space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={scopeSearch}
              onChange={(e) => setScopeSearch(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
              placeholder="搜索组织 / 部门 / 小组"
            />
          </div>
          <div className="rounded-[10px] border border-gray-200 bg-gray-50/60">
            {loading ? (
              <div className="flex h-24 items-center justify-center gap-2 text-sm text-gray-400">
                <Loader2 size={15} className="animate-spin" />
                加载可选范围...
              </div>
            ) : tree.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">当前没有可选组织范围</div>
            ) : filteredTree.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">没有匹配的范围</div>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                {filteredTree.map((tenant) => {
                  const orgScope: KbVisibilityScope = { scope_type: "org", scope_id: tenant.code };
                  const tenantOpen = searchText
                    ? autoExpandedTenantIds.has(tenant.code)
                    : expandedTenants.has(tenant.code) || selectedExpanded.tenants.has(tenant.code);
                  return (
                    <div key={tenant.code} className="rounded-[10px] border border-gray-200 bg-white p-2">
                      <div className="flex items-center gap-1 rounded-[8px] border border-gray-200 bg-gray-50 pr-2">
                        <ExpandButton
                          open={tenantOpen}
                          disabled={tenant.departments.length === 0}
                          onClick={() => toggleTenant(tenant.code)}
                        />
                        <ScopeCheckbox
                          checked={scopeKeys.has(kbVisibilityScopeKey(orgScope))}
                          label={`${tenant.name || tenant.code} (${tenant.code})`}
                          icon={<Building2 size={14} />}
                          onChange={() => onToggleScope(orgScope)}
                        />
                      </div>
                      {tenantOpen && tenant.departments.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-l border-gray-100 pl-5">
                          {tenant.departments.map((dept) => {
                            const deptScope: KbVisibilityScope = {
                              scope_type: "dept",
                              scope_id: dept.id,
                            };
                            const deptOpen = searchText
                              ? autoExpandedDeptIds.has(dept.id)
                              : expandedDepts.has(dept.id) || selectedExpanded.depts.has(dept.id);
                            return (
                              <div key={dept.id} className="space-y-1">
                                <div className="flex items-center gap-1 rounded-[8px] pr-2 hover:bg-gray-50">
                                  <ExpandButton
                                    open={deptOpen}
                                    disabled={dept.teams.length === 0}
                                    onClick={() => toggleDept(dept.id)}
                                    size="sm"
                                  />
                                  <ScopeCheckbox
                                    checked={scopeKeys.has(kbVisibilityScopeKey(deptScope))}
                                    label={dept.name}
                                    icon={<Users size={14} />}
                                    onChange={() => onToggleScope(deptScope)}
                                  />
                                </div>
                                {deptOpen && dept.teams.length > 0 && (
                                  <div className="grid grid-cols-1 gap-1 pl-8 sm:grid-cols-2">
                                    {dept.teams.map((team) => {
                                      const teamScope: KbVisibilityScope = {
                                        scope_type: "team",
                                        scope_id: team.id,
                                      };
                                      return (
                                        <ScopeCheckbox
                                          key={team.id}
                                          checked={scopeKeys.has(kbVisibilityScopeKey(teamScope))}
                                          label={team.name}
                                          dense
                                          onChange={() => onToggleScope(teamScope)}
                                        />
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {mode === "custom" && scopes.length === 0 && (
        <p className="text-xs text-red-500">请至少选择一个可见组织、部门或小组。</p>
      )}
    </div>
  );
}

function ExpandButton({
  open,
  disabled,
  size = "md",
  onClick,
}: {
  open: boolean;
  disabled?: boolean;
  size?: "md" | "sm";
  onClick: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center rounded-[8px] text-gray-500 transition hover:bg-white/80 disabled:cursor-default disabled:opacity-25 ${
        size === "sm" ? "h-7 w-7" : "h-8 w-8"
      }`}
      title={open ? "收起" : "展开"}
    >
      <Icon size={15} />
    </button>
  );
}

function ScopeCheckbox({
  checked,
  label,
  icon,
  dense,
  onChange,
}: {
  checked: boolean;
  label: string;
  icon?: ReactNode;
  dense?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[8px] transition hover:bg-gray-100 ${
        dense ? "px-2 py-1 text-xs text-gray-600" : "px-2 py-1.5 text-sm text-gray-700"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-[#002FA7]"
      />
      {icon && <span className="shrink-0 text-gray-400">{icon}</span>}
      <span className="truncate">{label}</span>
    </label>
  );
}
