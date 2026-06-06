"use client";
/**
 * 6.4up v2 Phase B · Tab 2 · 角色权限模板
 *
 * 编辑 builtin_role_permissions[system_admin] / [org_admin] 的默认包。
 * D2/D3 拍板 + C2/C3 硬约束：
 *   - 整组 PUT + 二次确认弹窗（"影响 N 个同角色管理员"）
 *   - 服务端差量写 + 读后校验
 *   - 双护栏（confirmBeforeHash + confirmAffectedCount）→ 412 PRECONDITION_FAILED
 *
 * D4：复用 permission-matrix.tsx 按 resource 分块；编辑模式（点击 chip 加/去）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle, RotateCcw, Save, Shield } from "lucide-react";
import {
  PermissionMatrix,
  CellState,
  splitKey,
} from "./permission-matrix";

type EditableRole = "system_admin" | "org_admin";

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

export function PermissionsTabTemplates(props: { adminKeys: readonly string[] }) {
  const { adminKeys } = props;
  const { toast } = useToast();

  const [role, setRole] = useState<EditableRole>("system_admin");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── 拉默认包 ─────────────────────────────────────────────────
  const load = useCallback(
    async (r: EditableRole) => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/admin/role-permissions/${r}`, {
          cache: "no-store",
        });
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
    },
    [toast],
  );

  useEffect(() => {
    void load(role);
  }, [role, load]);

  // ── diff 计算 ────────────────────────────────────────────────
  const diff = useMemo(() => {
    if (!snapshot) return { added: [] as string[], removed: [] as string[], dirty: false };
    const beforeSet = new Set(snapshot.permissionKeys);
    const added: string[] = [];
    const removed: string[] = [];
    for (const k of selectedSet) if (!beforeSet.has(k)) added.push(k);
    for (const k of beforeSet) if (!selectedSet.has(k)) removed.push(k);
    return { added, removed, dirty: added.length + removed.length > 0 };
  }, [snapshot, selectedSet]);

  // ── cell state resolver（区别"原默认包" vs "本次未保存增/减"）─
  const cellState = useMemo<(k: string) => CellState>(() => {
    if (!snapshot) return () => "off";
    const beforeSet = new Set(snapshot.permissionKeys);
    return (k) => {
      const wasOn = beforeSet.has(k);
      const isOn = selectedSet.has(k);
      if (wasOn && isOn) return "default";   // 原本持有，仍持有
      if (!wasOn && isOn) return "grant";    // 本次新增（保存后才进默认包；UI 借用 grant 配色表"待加")
      if (wasOn && !isOn) return "revoke";   // 本次移除
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

  // ── 保存（双护栏 + PUT 整组）─────────────────────────────────
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
        await load(role); // 重新拉，让 hash 与 count 对齐
        return;
      }
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        toast(e?.error ?? "保存失败", "error");
        return;
      }
      const d = await resp.json();
      const note = d.note === "无变化"
        ? "无变化"
        : `已保存：新增 ${d.added} / 移除 ${d.removed}`;
      toast(note);
      setShowConfirm(false);
      await load(role);
    } finally {
      setSaving(false);
    }
  }

  // 用 only-admin 视角的全集（去掉 setting / permission）
  const visibleKeys = useMemo(() => {
    return adminKeys.filter((k) => {
      const p = splitKey(k);
      if (!p) return false;
      if (p.resource === "setting" || p.resource === "permission") return false;
      return true;
    });
  }, [adminKeys]);

  return (
    <div className="mt-4">
      {/* role 切换 */}
      <Card className="p-3 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] text-gray-500 mr-1">编辑角色：</span>
          {(["system_admin", "org_admin"] as EditableRole[]).map((r) => (
            <button
              key={r}
              onClick={() => {
                if (diff.dirty) {
                  if (!confirm("当前角色有未保存改动，切换将丢弃。继续？")) return;
                }
                setRole(r);
              }}
              className={
                "text-[12px] px-3 py-1.5 rounded-full border transition-colors " +
                (role === r
                  ? "bg-[#002FA7] text-white border-[#002FA7]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-[#002FA7]/40")
              }
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-500">
            <Shield size={12} />
            super_admin 硬全权，不在此处管理
          </div>
        </div>
      </Card>

      {/* 矩阵 */}
      <Card className="p-4 mb-20 min-h-[400px]">
        {loading && (
          <p className="text-[12px] text-gray-400 text-center py-12">加载中…</p>
        )}
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
              <code className="ml-auto text-[10px] text-gray-300 font-mono">
                hash:{snapshot.beforeHash.slice(0, 8)}…
              </code>
            </div>
            <PermissionMatrix
              allKeys={visibleKeys}
              resolveCellState={cellState}
              editable={true}
              onToggle={toggleKey}
            />
          </>
        )}
      </Card>

      {/* sticky 底部操作栏 */}
      {snapshot && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30">
          <div
            className={
              "flex items-center gap-3 px-4 py-2.5 rounded-full shadow-xl border transition-all " +
              (diff.dirty
                ? "bg-white border-[#002FA7]/30"
                : "bg-white/95 border-gray-200 opacity-80")
            }
          >
            <span className="text-[12px] text-gray-600">
              {diff.dirty
                ? `${ROLE_LABEL[role]} · 待加 ${diff.added.length} / 待去 ${diff.removed.length}`
                : `${ROLE_LABEL[role]} · 无变化`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!diff.dirty || saving}
              onClick={reset}
            >
              <RotateCcw size={14} className="mr-1" /> 重置
            </Button>
            <Button
              size="sm"
              disabled={!diff.dirty || saving}
              onClick={() => setShowConfirm(true)}
            >
              <Save size={14} className="mr-1" /> 保存
            </Button>
          </div>
        </div>
      )}

      {/* 二次确认弹窗（D3：仅 Tab 2 弹） */}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
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
              （仅 enforce 启用时生效；当前 PERMISSION_V2_ENFORCE_RESOURCES 留空 → 行为零变化，仅写入数据库）
            </p>
          </div>

          {added.length > 0 && (
            <div>
              <p className="text-[12px] text-emerald-700 font-semibold mb-1">
                新增 {added.length} 项
              </p>
              <div className="flex flex-wrap gap-1">
                {added.slice(0, 20).map((k) => (
                  <code
                    key={k}
                    className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-mono"
                  >
                    {k}
                  </code>
                ))}
                {added.length > 20 && (
                  <span className="text-[10px] text-gray-400">
                    …还有 {added.length - 20} 项
                  </span>
                )}
              </div>
            </div>
          )}
          {removed.length > 0 && (
            <div>
              <p className="text-[12px] text-rose-700 font-semibold mb-1">
                移除 {removed.length} 项
              </p>
              <div className="flex flex-wrap gap-1">
                {removed.slice(0, 20).map((k) => (
                  <code
                    key={k}
                    className="text-[10px] px-1.5 py-0.5 bg-rose-50 text-rose-700 rounded font-mono"
                  >
                    {k}
                  </code>
                ))}
                {removed.length > 20 && (
                  <span className="text-[10px] text-gray-400">
                    …还有 {removed.length - 20} 项
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={saving} onClick={onCancel}>
              取消
            </Button>
            <Button disabled={saving} onClick={onConfirm}>
              {saving ? "保存中…" : "确认保存"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
