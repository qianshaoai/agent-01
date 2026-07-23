"use client";

/**
 * 6.3up R1.1 · 工作流分层级配置
 *
 * 路由：/admin/workflow-config（工作流管理头部按钮 进入）
 * 权限：super_admin + system_admin（页面级 guard + 服务端 isWorkflowConfigAdmin 双闸）
 *
 * 三栏导航：组织 → 部门 → 小组；选定某 scope 后右侧显示该 scope 已配置的工作流卡片，
 * 支持 HTML5 拖拽排序 + 移除 + 弹窗"+ 添加工作流"批量勾选。
 *
 * "拉取"（POST workflow-scope-order）会同步写 resource_permissions —— 让该层级
 * 既可见又按顺序展示（路径 P1）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPageFrame as AdminLayout } from "@/components/layout/admin-layout";
import { useAdminSession } from "@/components/admin/admin-session-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";
import { isWorkflowConfigAdmin, type AdminRole } from "@/lib/admin-permissions";
import { Building2, FolderTree, Users, GitBranch, GripVertical, X, Plus, ChevronRight, Search, ArrowLeft } from "lucide-react";

type Team = { id: string; name: string; dept_id: string; sort_order: number | null };
type Dept = { id: string; name: string; tenant_code: string; sort_order: number | null; teams: Team[] };
type Tenant = { code: string; name: string; enabled: boolean; departments: Dept[] };

type ScopeType = "org" | "dept" | "team";
type Scope = { type: ScopeType; id: string; label: string };

type ScopeOrderItem = {
  workflow_id: string;
  sort_order: number;
  name: string;
  description: string;
  enabled: boolean;
  visible_to: string | null;
  missing: boolean;
};

type WorkflowOption = { id: string; name: string; description: string; enabled: boolean; visible_to: string | null };

export default function WorkflowConfigPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { me, status: sessionStatus } = useAdminSession();
  const meLoading = sessionStatus === "loading";
  const meRole = (me?.role ?? me?.builtinRole ?? null) as AdminRole | null;

  const [tree, setTree] = useState<Tenant[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [selectedTenantCode, setSelectedTenantCode] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [items, setItems] = useState<ScopeOrderItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // R1.6 · 四个小窗的搜索状态
  const [orgSearch, setOrgSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");

  const addGuard = useSubmitGuard();
  const reorderGuard = useSubmitGuard();
  const removeGuard = useSubmitGuard();

  // ── 角色 guard ────────────────────────────────────────────────
  useEffect(() => {
    if (meLoading) return;
    if (!meRole) {
      router.replace("/admin");
      return;
    }
    if (!isWorkflowConfigAdmin(meRole)) {
      router.replace("/admin/dashboard");
    }
  }, [meLoading, meRole, router]);

  // ── 拉 scope-tree ────────────────────────────────────────────
  useEffect(() => {
    if (meLoading || !meRole || !isWorkflowConfigAdmin(meRole)) return;
    setTreeLoading(true);
    fetch("/api/admin/scope-tree", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Tenant[]) => setTree(Array.isArray(data) ? data : []))
      .catch(() => toast("加载组织树失败", "error"))
      .finally(() => setTreeLoading(false));
  }, [meLoading, meRole, toast]);

  // ── 当前 scope（最具体的选择）─────────────────────────────────
  const currentScope: Scope | null = useMemo(() => {
    if (selectedTeamId) {
      const dept = tree.find((t) => t.code === selectedTenantCode)?.departments.find((d) => d.id === selectedDeptId);
      const team = dept?.teams.find((tm) => tm.id === selectedTeamId);
      if (team) return { type: "team", id: team.id, label: `${team.name}（小组）` };
    }
    if (selectedDeptId) {
      const dept = tree.find((t) => t.code === selectedTenantCode)?.departments.find((d) => d.id === selectedDeptId);
      if (dept) return { type: "dept", id: dept.id, label: `${dept.name}（部门）` };
    }
    if (selectedTenantCode) {
      const t = tree.find((tt) => tt.code === selectedTenantCode);
      if (t) return { type: "org", id: t.code, label: `${t.name}（组织）` };
    }
    return null;
  }, [tree, selectedTenantCode, selectedDeptId, selectedTeamId]);

  // ── 拉当前 scope 已配置工作流 ─────────────────────────────────
  function reloadItems(scope: Scope | null) {
    if (!scope) { setItems([]); return; }
    setItemsLoading(true);
    fetch(`/api/admin/workflow-scope-order?scope_type=${scope.type}&scope_id=${encodeURIComponent(scope.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: ScopeOrderItem[]) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast("加载已配置工作流失败", "error"))
      .finally(() => setItemsLoading(false));
  }
  // 仅当 scope 的 type / id 变化时重新拉取（label 变化不必触发；reloadItems 引用稳定）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reloadItems(currentScope); }, [currentScope?.type, currentScope?.id]);

  // ── 拖拽排序 ──────────────────────────────────────────────────
  const dragIdRef = useRef<string | null>(null);
  function onDragStart(id: string) { dragIdRef.current = id; }
  function onDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const src = dragIdRef.current;
    if (!src || src === targetId) return;
    setItems((prev) => {
      const next = [...prev];
      const srcIdx = next.findIndex((x) => x.workflow_id === src);
      const tgtIdx = next.findIndex((x) => x.workflow_id === targetId);
      if (srcIdx < 0 || tgtIdx < 0) return prev;
      const [item] = next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, item);
      return next;
    });
  }
  function onDragEnd() {
    const scope = currentScope;
    const orderedIds = items.map((x) => x.workflow_id);
    dragIdRef.current = null;
    if (!scope) return;
    reorderGuard.submit(async () => {
      const res = await fetch("/api/admin/workflow-scope-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_type: scope.type, scope_id: scope.id, orderedIds }),
      });
      if (!res.ok) {
        toast("保存排序失败", "error");
        reloadItems(scope);
        return;
      }
      toast("排序已保存", "success");
    });
  }

  // ── 移除 ──────────────────────────────────────────────────────
  function removeOne(workflowId: string) {
    const scope = currentScope;
    if (!scope) return;
    if (!confirm("确定移除该工作流？\n操作会同时取消该层级的可见权限与排序。")) return;
    removeGuard.submit(async () => {
      const res = await fetch("/api/admin/workflow-scope-order", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_type: scope.type, scope_id: scope.id, workflowId }),
      });
      if (!res.ok) {
        toast("移除失败", "error");
        return;
      }
      toast("已移除", "success");
      setItems((prev) => prev.filter((x) => x.workflow_id !== workflowId));
    });
  }

  // ── 添加 ──────────────────────────────────────────────────────
  function handleAdded(addedIds: string[]) {
    const scope = currentScope;
    if (!scope || addedIds.length === 0) { setShowAdd(false); return; }
    addGuard.submit(async () => {
      const res = await fetch("/api/admin/workflow-scope-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_type: scope.type, scope_id: scope.id, workflowIds: addedIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.error ?? "添加失败", "error");
        return;
      }
      const j = await res.json();
      toast(`已添加 ${j.added} 个，跳过已存在 ${j.skipped} 个`, "success");
      setShowAdd(false);
      reloadItems(scope);
    });
  }

  // ── render ────────────────────────────────────────────────────
  if (meLoading) {
    return (
      <AdminLayout>
        <div className="p-8 text-gray-400">加载中…</div>
      </AdminLayout>
    );
  }
  if (!meRole || !isWorkflowConfigAdmin(meRole)) {
    return (
      <AdminLayout>
        <div className="p-8 text-gray-500">无权访问该页面</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<GitBranch size={20} />}
          title="工作流配置"
          actions={
            <Button
              variant="outline"
              onClick={() => router.push("/admin/workflows")}
              className="gap-2"
              title="返回工作流管理"
            >
              <ArrowLeft size={16} /> 返回
            </Button>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 左：scope 三栏导航 */}
          <div className="lg:col-span-4 space-y-3">
            <Card padding="md">
              <h3 className="text-[14px] font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Building2 size={16} className="text-[#002FA7]" />
                选择组织
                <span className="ml-auto text-[11px] font-normal text-gray-400">共 {tree.length}</span>
              </h3>
              {treeLoading ? (
                <p className="text-sm text-gray-400">加载中…</p>
              ) : tree.length === 0 ? (
                <p className="text-sm text-gray-400">暂无组织</p>
              ) : (() => {
                const kw = orgSearch.trim().toLowerCase();
                const filtered = kw
                  ? tree.filter((t) => t.name.toLowerCase().includes(kw) || t.code.toLowerCase().includes(kw))
                  : tree;
                return (
                  <>
                    <MiniSearch value={orgSearch} onChange={setOrgSearch} placeholder="搜索组织名称或代码…" />
                    <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                      {filtered.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-3">无匹配组织</p>
                      ) : filtered.map((t) => {
                        const active = selectedTenantCode === t.code;
                        return (
                          <button
                            key={t.code}
                            type="button"
                            onClick={() => {
                              setSelectedTenantCode(t.code);
                              setSelectedDeptId(null);
                              setSelectedTeamId(null);
                            }}
                            className={
                              "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-left text-sm transition-colors " +
                              (active ? "bg-[#002FA7] text-white" : "hover:bg-gray-50 text-gray-700")
                            }
                          >
                            <span className="truncate">
                              {t.name}
                              {!t.enabled && <span className={active ? "ml-2 text-white/70" : "ml-2 text-amber-500"}>（停用）</span>}
                            </span>
                            <span className={"text-[11px] font-mono " + (active ? "text-white/80" : "text-gray-400")}>{t.code}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </Card>

            {selectedTenantCode && (() => {
              const depts = tree.find((t) => t.code === selectedTenantCode)?.departments ?? [];
              const kw = deptSearch.trim().toLowerCase();
              const filtered = kw ? depts.filter((d) => d.name.toLowerCase().includes(kw)) : depts;
              return (
                <Card padding="md">
                  <h3 className="text-[14px] font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <FolderTree size={16} className="text-[#002FA7]" />
                    选择部门（可选）
                    <span className="ml-auto text-[11px] font-normal text-gray-400">共 {depts.length}</span>
                  </h3>
                  {depts.length === 0 ? (
                    <p className="text-sm text-gray-400">该组织暂无部门</p>
                  ) : (
                    <>
                      <MiniSearch value={deptSearch} onChange={setDeptSearch} placeholder="搜索部门名称…" />
                      <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                        <button
                          type="button"
                          onClick={() => { setSelectedDeptId(null); setSelectedTeamId(null); }}
                          className={
                            "w-full text-left px-3 py-1.5 text-xs rounded-[8px] " +
                            (!selectedDeptId ? "bg-[#002FA7]/10 text-[#002FA7] font-medium" : "text-gray-500 hover:bg-gray-50")
                          }
                        >
                          ← 只配置组织层级
                        </button>
                        {filtered.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-3">无匹配部门</p>
                        ) : filtered.map((d) => {
                          const active = selectedDeptId === d.id;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => { setSelectedDeptId(d.id); setSelectedTeamId(null); }}
                              className={
                                "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-left text-sm transition-colors " +
                                (active ? "bg-[#002FA7] text-white" : "hover:bg-gray-50 text-gray-700")
                              }
                            >
                              <span className="truncate">{d.name}</span>
                              <ChevronRight size={14} className={active ? "text-white/80" : "text-gray-400"} />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </Card>
              );
            })()}

            {selectedTenantCode && selectedDeptId && (() => {
              const teams = tree.find((t) => t.code === selectedTenantCode)?.departments.find((d) => d.id === selectedDeptId)?.teams ?? [];
              const kw = teamSearch.trim().toLowerCase();
              const filtered = kw ? teams.filter((tm) => tm.name.toLowerCase().includes(kw)) : teams;
              return (
                <Card padding="md">
                  <h3 className="text-[14px] font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <Users size={16} className="text-[#002FA7]" />
                    选择小组（可选）
                    <span className="ml-auto text-[11px] font-normal text-gray-400">共 {teams.length}</span>
                  </h3>
                  {teams.length === 0 ? (
                    <p className="text-sm text-gray-400">该部门暂无小组</p>
                  ) : (
                    <>
                      <MiniSearch value={teamSearch} onChange={setTeamSearch} placeholder="搜索小组名称…" />
                      <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                        <button
                          type="button"
                          onClick={() => setSelectedTeamId(null)}
                          className={
                            "w-full text-left px-3 py-1.5 text-xs rounded-[8px] " +
                            (!selectedTeamId ? "bg-[#002FA7]/10 text-[#002FA7] font-medium" : "text-gray-500 hover:bg-gray-50")
                          }
                        >
                          ← 只配置部门层级
                        </button>
                        {filtered.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-3">无匹配小组</p>
                        ) : filtered.map((tm) => {
                          const active = selectedTeamId === tm.id;
                          return (
                            <button
                              key={tm.id}
                              type="button"
                              onClick={() => setSelectedTeamId(tm.id)}
                              className={
                                "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-left text-sm transition-colors " +
                                (active ? "bg-[#002FA7] text-white" : "hover:bg-gray-50 text-gray-700")
                              }
                            >
                              <span className="truncate">{tm.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </Card>
              );
            })()}
          </div>

          {/* 右：已配置工作流 */}
          <div className="lg:col-span-8">
            <Card padding="md">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-gray-800">
                    {currentScope ? `当前层级：${currentScope.label}` : "请在左侧选择组织 / 部门 / 小组"}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {currentScope
                      ? "拖拽卡片调整顺序；移除会同时取消该层级可见权限。"
                      : "未选择层级时不显示工作流。"}
                  </p>
                </div>
                {currentScope && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowAdd(true)}
                    loading={addGuard.loading}
                  >
                    <Plus size={14} /> 添加工作流
                  </Button>
                )}
              </div>

              {!currentScope ? null : itemsLoading ? (
                <p className="text-sm text-gray-400">加载中…</p>
              ) : items.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  该层级暂无配置工作流。点击右上「添加工作流」开始。
                </div>
              ) : (() => {
                const kw = itemSearch.trim().toLowerCase();
                const isSearching = kw.length > 0;
                const filtered = isSearching
                  ? items.filter((it) =>
                      it.name.toLowerCase().includes(kw) ||
                      (it.description ?? "").toLowerCase().includes(kw)
                    )
                  : items;
                return (
                  <>
                    {items.length > 5 && (
                      <MiniSearch value={itemSearch} onChange={setItemSearch} placeholder="搜索工作流名称或描述…" />
                    )}
                    {isSearching && (
                      <p className="text-[11px] text-amber-600 mb-2 -mt-1">
                        搜索过滤期间已禁用拖拽（PUT 接口要求 orderedIds 是完整集合）；清空搜索框可恢复
                      </p>
                    )}
                    <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                      {filtered.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-3">无匹配工作流</p>
                      ) : filtered.map((it) => (
                        <div
                          key={it.workflow_id}
                          draggable={!isSearching}
                          onDragStart={() => !isSearching && onDragStart(it.workflow_id)}
                          onDragOver={(e) => !isSearching && onDragOver(e, it.workflow_id)}
                          onDragEnd={() => !isSearching && onDragEnd()}
                          className={
                            "flex items-center gap-3 px-3 py-2.5 border border-gray-200 rounded-[10px] bg-white transition-colors " +
                            (isSearching ? "cursor-default" : "hover:border-[#002FA7]/30 cursor-move")
                          }
                        >
                          <GripVertical size={16} className={"shrink-0 " + (isSearching ? "text-gray-200" : "text-gray-300")} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className={"text-sm font-medium truncate " + (it.missing ? "text-red-500" : "text-gray-800")}>
                                {it.name}
                              </p>
                              {!it.enabled && !it.missing && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">已停用</span>
                              )}
                              {it.missing && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">已删除</span>
                              )}
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 font-mono">#{it.sort_order}</span>
                            </div>
                            {it.description && (
                              <p className="text-xs text-gray-500 truncate mt-0.5">{it.description}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeOne(it.workflow_id)}
                            className="p-1.5 rounded-[8px] text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors shrink-0"
                            title="从该层级移除"
                            disabled={removeGuard.loading}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </Card>
          </div>
        </div>
      </div>

      {showAdd && currentScope && (
        <AddWorkflowModal
          scope={currentScope}
          existingIds={new Set(items.map((x) => x.workflow_id))}
          onCancel={() => setShowAdd(false)}
          onConfirm={handleAdded}
          loading={addGuard.loading}
        />
      )}
    </AdminLayout>
  );
}

// ── R1.6 · 小窗顶部搜索框 ──────────────────────────────────────
function MiniSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-2">
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-7 pl-7 pr-7 rounded-[8px] border border-gray-200 text-xs focus:outline-none focus:border-[#002FA7] focus:ring-1 focus:ring-[#002FA7]/10"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          aria-label="清空搜索"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ── 添加工作流弹窗 ──────────────────────────────────────────────
function AddWorkflowModal({
  scope,
  existingIds,
  onCancel,
  onConfirm,
  loading,
}: {
  scope: Scope;
  existingIds: Set<string>;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
  loading: boolean;
}) {
  const [list, setList] = useState<WorkflowOption[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    // R1.3 Finding 1 修复：改调专用轻量端点（无分页，HARD_CAP=5000），
    // 旧版调 /api/admin/workflows?pageSize=200 会被 PAGINATION.MAX_PAGE_SIZE=100 静默截断。
    fetch("/api/admin/workflows-compact", { cache: "no-store" })
      .then((r) => r.json())
      .then((res) => {
        const arr: WorkflowOption[] = Array.isArray(res?.data)
          ? res.data.map((w: { id: string; name: string; description: string | null; enabled: boolean; visible_to: string | null }) => ({
              id: w.id,
              name: w.name,
              description: w.description ?? "",
              enabled: !!w.enabled,
              visible_to: w.visible_to ?? null,
            }))
          : [];
        setList(arr);
        setTruncated(!!res?.truncated);
      })
      .finally(() => setLoadingList(false));
  }, []);

  // R1.2 Finding 3 修复：把 personal_only 工作流从弹窗中过滤掉
  //   它即使写进 order+permissions 也不会被组织用户看到（helper 在 visible_to 短路时直接拒），
  //   会让管理员"添加成功"但用户依然看不到，形成 dead config。
  const personalOnlyHidden = list.filter((w) => w.visible_to === "personal_only").length;
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return list
      .filter((w) => w.visible_to !== "personal_only")
      .filter((w) => !existingIds.has(w.id))
      .filter((w) => !kw || w.name.toLowerCase().includes(kw) || (w.description ?? "").toLowerCase().includes(kw));
  }, [list, existingIds, search]);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-[14px] shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-[15px] font-semibold text-gray-800">添加工作流到「{scope.label}」</h3>
          <p className="text-xs text-gray-500 mt-1">
            勾选后会同时写入该层级的可见权限与排序（接在已配置末尾）。
          </p>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索工作流名称或描述"
              className="w-full pl-9 pr-3 h-9 rounded-[10px] border border-gray-200 text-sm focus:outline-none focus:border-[#002FA7]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loadingList ? (
            <p className="text-sm text-gray-400">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">无可添加的工作流（全部已存在或被搜索过滤）</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((w) => {
                const checked = picked.has(w.id);
                return (
                  <label
                    key={w.id}
                    className={
                      "flex items-start gap-3 px-3 py-2.5 rounded-[10px] cursor-pointer transition-colors " +
                      (checked ? "bg-[#002FA7]/8 border border-[#002FA7]/30" : "border border-gray-100 hover:bg-gray-50")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePick(w.id)}
                      className="mt-1 accent-[#002FA7]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{w.name}</p>
                        {!w.enabled && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">已停用</span>}
                        {w.visible_to && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 font-mono">{w.visible_to}</span>
                        )}
                      </div>
                      {w.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{w.description}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            已选 <span className="font-semibold text-[#002FA7]">{picked.size}</span> / {filtered.length}
            {personalOnlyHidden > 0 && (
              <span className="ml-2 text-gray-400">
                （已隐藏 {personalOnlyHidden} 个个人工作流 · 不可分配到组织层级）
              </span>
            )}
            {truncated && (
              <span className="ml-2 text-amber-600">
                （工作流总数达上限 · 已截断 · 请联系平台处理）
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              disabled={picked.size === 0}
              onClick={() => onConfirm([...picked])}
            >
              确认添加（{picked.size}）
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
