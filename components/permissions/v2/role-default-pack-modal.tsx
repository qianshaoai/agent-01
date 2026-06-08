"use client";
/**
 * 6.6up · 内置角色默认包编辑弹窗
 *
 * 把原「角色模板」Tab（tab-templates.tsx）的默认包编辑器抽成弹窗，供合并后的「角色管理」
 * 里内置角色（系统管理员 / 组织管理员）卡片的「编辑权限」用。逻辑等价：
 *   - 编辑 builtin_role_permissions[role] 整组 PUT
 *   - 保存二次确认（"影响 N 个同角色管理员"）+ 双护栏（confirmBeforeHash + confirmAffectedCount → 412）
 *   - 复用 permission-matrix.tsx 按 resource 分块、编辑模式
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle, RotateCcw, Save, X } from "lucide-react";
import { PermissionMatrix, CellState, splitKey } from "./permission-matrix";

export type EditableRole = "system_admin" | "org_admin";

const ROLE_LABEL: Record<EditableRole, string> = {
  system_admin: "系统管理员",
  org_admin: "组织管理员",
};

type Snapshot = {
  role: EditableRole;
  permissionKeys: string[];
  beforeHash: string;
  affectedCount: number;
};

export function RoleDefaultPackModal({
  role,
  adminKeys,
  onClose,
}: {
  role: EditableRole;
  adminKeys: readonly string[];
  onClose: (refresh?: boolean) => void;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/admin/role-permissions/${role}`, { cache: "no-store" });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        toast(e?.error ?? "加载角色默认包失败", "error");
        setSnapshot(null);
        setSelectedSet(new Set());
        return;
      }
      const snap = (await resp.json()) as Snapshot;
      setSnapshot(snap);
      setSelectedSet(new Set(snap.permissionKeys));
    } finally {
      setLoading(false);
    }
  }, [role, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const diff = useMemo(() => {
    if (!snapshot) return { added: [] as string[], removed: [] as string[], dirty: false };
    const beforeSet = new Set(snapshot.permissionKeys);
    const added: string[] = [];
    const removed: string[] = [];
    for (const k of selectedSet) if (!beforeSet.has(k)) added.push(k);
    for (const k of beforeSet) if (!selectedSet.has(k)) removed.push(k);
    return { added, removed, dirty: added.length + removed.length > 0 };
  }, [snapshot, selectedSet]);

  const cellState = useMemo<(k: string) => CellState>(() => {
    if (!snapshot) return () => "off";
    const beforeSet = new Set(snapshot.permissionKeys);
    return (k) => {
      const wasOn = beforeSet.has(k);
      const isOn = selectedSet.has(k);
      if (wasOn && isOn) return "default";
      if (!wasOn && isOn) return "grant";
      if (wasOn && !isOn) return "revoke";
      return "off";
    };
  }, [snapshot, selectedSet]);

  function toggleKey(k: string, nextOn: boolean) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (nextOn) next.add(k);
      else next.delete(k);
      return next;
    });
  }

  function reset() {
    if (!snapshot) return;
    setSelectedSet(new Set(snapshot.permissionKeys));
  }

  async function commit() {
    if (!snapshot) return;
    setSaving(true);
    try {
      const target = [...selectedSet].sort();
      const resp = await fetch(`/api/admin/role-permissions/${role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionKeys: target,
          confirmAffectedCount: snapshot.affectedCount,
          confirmBeforeHash: snapshot.beforeHash,
        }),
      });
      if (resp.status === 412) {
        const e = await resp.json().catch(() => ({}));
        toast(e?.error ?? "权限模板已被其它管理员改动，请刷新", "error");
        setShowConfirm(false);
        await load();
        return;
      }
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        toast(e?.error ?? "保存失败", "error");
        return;
      }
      const d = await resp.json();
      toast(d.note === "无变化" ? "无变化" : `已保存：新增 ${d.added} / 移除 ${d.removed}`);
      setShowConfirm(false);
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  const visibleKeys = useMemo(() => {
    return adminKeys.filter((k) => {
      const p = splitKey(k);
      if (!p) return false;
      if (p.resource === "setting" || p.resource === "permission") return false;
      return true;
    });
  }, [adminKeys]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[760px] my-10 max-h-[calc(100vh-5rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 h-12 border-b border-gray-100 shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900">
            编辑「{ROLE_LABEL[role]}」默认包
          </h2>
          <button onClick={() => onClose()} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          {loading && <p className="text-[12px] text-gray-400 text-center py-12">加载中…</p>}
          {!loading && snapshot && (
            <>
              <div className="mb-3 flex items-center gap-4 flex-wrap text-[11px] text-gray-500 pb-3 border-b border-gray-100">
                <span>
                  当前默认包：<b className="text-gray-800">{snapshot.permissionKeys.length}</b> keys
                </span>
                <span>
                  受影响管理员：<b className="text-gray-800">{snapshot.affectedCount}</b> 人
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  本次待加 <b className="text-emerald-700">{diff.added.length}</b> · 待去{" "}
                  <b className="text-rose-600">{diff.removed.length}</b>
                </span>
              </div>
              <PermissionMatrix
                allKeys={visibleKeys}
                resolveCellState={cellState}
                editable={true}
                onToggle={toggleKey}
              />
            </>
          )}
        </div>

        {snapshot && (
          <div className="sticky bottom-0 px-5 py-3 bg-white border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
            <span className="text-[12px] text-gray-500 mr-auto">
              {diff.dirty
                ? `待加 ${diff.added.length} / 待去 ${diff.removed.length}`
                : "无变化"}
            </span>
            <Button variant="ghost" size="sm" disabled={!diff.dirty || saving} onClick={reset}>
              <RotateCcw size={14} className="mr-1" /> 重置
            </Button>
            <Button size="sm" disabled={!diff.dirty || saving} onClick={() => setShowConfirm(true)}>
              <Save size={14} className="mr-1" /> 保存
            </Button>
          </div>
        )}
      </div>

      {showConfirm && snapshot && (
        <ConfirmModal
          role={role}
          affectedCount={snapshot.affectedCount}
          added={diff.added}
          removed={diff.removed}
          saving={saving}
          onConfirm={commit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

function ConfirmModal(props: {
  role: EditableRole;
  affectedCount: number;
  added: string[];
  removed: string[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { role, affectedCount, added, removed, saving, onConfirm, onCancel } = props;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[560px] my-10">
        <div className="px-5 h-12 border-b border-gray-100 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <h2 className="text-[15px] font-semibold text-gray-900">
            保存「{ROLE_LABEL[role]}」默认包
          </h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-[10px] bg-amber-50 border border-amber-200 p-3">
            <p className="text-[13px] text-amber-800">
              此次改动将<b>立刻影响 {affectedCount} 名</b>「{ROLE_LABEL[role]}」管理员的可用能力。
            </p>
            <p className="text-[11px] text-amber-700 mt-1">
              （6.6up 默认全资源 enforce；紧急回滚请将 PERMISSION_V2_ENFORCE_RESOURCES 设为 none）
            </p>
          </div>
          {added.length > 0 && (
            <div>
              <p className="text-[12px] text-emerald-700 font-semibold mb-1">新增 {added.length} 项</p>
              <div className="flex flex-wrap gap-1">
                {added.slice(0, 20).map((k) => (
                  <code key={k} className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-mono">
                    {k}
                  </code>
                ))}
                {added.length > 20 && (
                  <span className="text-[10px] text-gray-400">…还有 {added.length - 20} 项</span>
                )}
              </div>
            </div>
          )}
          {removed.length > 0 && (
            <div>
              <p className="text-[12px] text-rose-700 font-semibold mb-1">移除 {removed.length} 项</p>
              <div className="flex flex-wrap gap-1">
                {removed.slice(0, 20).map((k) => (
                  <code key={k} className="text-[10px] px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded font-mono">
                    {k}
                  </code>
                ))}
                {removed.length > 20 && (
                  <span className="text-[10px] text-gray-400">…还有 {removed.length - 20} 项</span>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={saving} onClick={onCancel}>取消</Button>
            <Button disabled={saving} onClick={onConfirm}>{saving ? "保存中…" : "确认保存"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
