"use client";
/**
 * 6.4up v2 Phase B · Tab 3 · 自定义角色
 *
 * 等价搬迁 6.4up 原 app/admin/permissions/page.tsx 的全部内容（去 AdminLayout/PageHeader）。
 * 接口契约：/api/admin/custom-roles + /api/admin/user-custom-roles 不动；
 *           Tab 3 行为与原 6.4up 完全等价（验收口径）。
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Plus, Users, Pencil, Trash2, X, Search } from "lucide-react";
import { RESOURCE_LABEL } from "./permission-matrix";

type RoleRow = {
  id: string;
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  permissions: string[];
  user_count: number;
};

type PermissionKeyMeta = {
  key: string;
  resource: string;
  action: string;
  scope: string;
  requiresSuperToGrant: boolean;
};

type TemplateMap = Record<
  string,
  { label: string; description: string; permissions: readonly string[] }
>;

const SCOPE_LABEL: Record<string, string> = {
  team: "本小组",
  dept: "本部门",
  org: "本组织",
  all: "全平台",
};
const ACTION_LABEL: Record<string, string> = {
  read: "查看",
  create: "新建",
  update: "编辑",
};

export function PermissionsTabCustomRoles() {
  const router = useRouter();
  const { toast } = useToast();

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ keys: PermissionKeyMeta[]; templates: TemplateMap } | null>(null);

  const [editTarget, setEditTarget] = useState<RoleRow | "new" | null>(null);
  const [bindTarget, setBindTarget] = useState<RoleRow | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/custom-roles", { cache: "no-store" });
      if (r.status === 403) {
        router.replace("/admin/dashboard");
        return;
      }
      const d = await r.json();
      setRoles(d.data ?? []);
    } catch {
      toast("加载角色失败", "error");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    void loadRoles();
    fetch("/api/admin/permission-keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMeta(d))
      .catch(() => {});
  }, [loadRoles]);

  async function handleDelete(role: RoleRow) {
    if (
      !confirm(
        `确认删除角色「${role.name}」？\n已绑定 ${role.user_count} 个用户的关联也会同步移除（不影响他们已创建的工作流）。`,
      )
    )
      return;
    try {
      const r = await fetch(`/api/admin/custom-roles/${role.id}`, { method: "DELETE" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast(e?.error ?? "删除失败", "error");
        return;
      }
      toast("已删除");
      await loadRoles();
    } catch {
      toast("删除失败", "error");
    }
  }

  return (
    <div className="mt-4">
      <div className="flex justify-end mb-3">
        <Button onClick={() => setEditTarget("new")}>
          <Plus size={16} className="mr-1" /> 新建角色
        </Button>
      </div>

      <div className="space-y-3">
        {loading && (
          <Card className="p-6">
            <div className="h-5 w-32 bg-gray-100 rounded animate-pulse mb-3" />
            <div className="h-4 w-64 bg-gray-100 rounded animate-pulse" />
          </Card>
        )}
        {!loading && roles.length === 0 && (
          <Card className="p-10 text-center text-gray-400 text-[13px]">
            还没有自定义角色。点右上「新建角色」开始配置。
          </Card>
        )}
        {!loading &&
          roles.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[15px] font-semibold text-gray-900">{r.name}</h3>
                    <code className="text-[11px] px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                      {r.code}
                    </code>
                    {!r.enabled && (
                      <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded">
                        已停用
                      </span>
                    )}
                    <span className="text-[11px] text-gray-400 ml-auto">
                      已绑定 {r.user_count} 个用户
                    </span>
                  </div>
                  {r.description && (
                    <p className="text-[12px] text-gray-500 mt-1.5">{r.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {r.permissions.length === 0 && (
                      <span className="text-[12px] text-gray-400">尚未配置权限</span>
                    )}
                    {r.permissions.map((k) => (
                      <span
                        key={k}
                        className="text-[11px] px-2 py-1 bg-[#002FA7]/8 text-[#002FA7] rounded font-mono"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setBindTarget(r)}>
                    <Users size={14} className="mr-1" /> 用户
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditTarget(r)}>
                    <Pencil size={14} className="mr-1" /> 编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(r)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} className="mr-1" /> 删除
                  </Button>
                </div>
              </div>
            </Card>
          ))}
      </div>

      {editTarget !== null && meta && (
        <RoleEditModal
          target={editTarget}
          meta={meta}
          onClose={(refresh) => {
            setEditTarget(null);
            if (refresh) void loadRoles();
          }}
        />
      )}

      {bindTarget && (
        <RoleBindUsersModal
          role={bindTarget}
          onClose={(refresh) => {
            setBindTarget(null);
            if (refresh) void loadRoles();
          }}
        />
      )}
    </div>
  );
}

// ─── 角色编辑 / 新建 modal ────────────────────────────────────

function RoleEditModal({
  target,
  meta,
  onClose,
}: {
  target: RoleRow | "new";
  meta: { keys: PermissionKeyMeta[]; templates: TemplateMap };
  onClose: (refresh?: boolean) => void;
}) {
  const { toast } = useToast();
  const isNew = target === "new";
  const initial = isNew
    ? { name: "", code: "", description: "", enabled: true, permissions: [] as string[] }
    : target;
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [description, setDescription] = useState(initial.description);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [perms, setPerms] = useState<Set<string>>(new Set(initial.permissions));
  const [saving, setSaving] = useState(false);

  const grouped = meta.keys.reduce<Record<string, PermissionKeyMeta[]>>((acc, k) => {
    (acc[k.resource] ??= []).push(k);
    return acc;
  }, {});

  function toggle(key: string) {
    setPerms((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyTemplate(tpl: { permissions: readonly string[] }) {
    setPerms(new Set(tpl.permissions));
  }

  async function save() {
    if (!name.trim()) return toast("请填写角色名称", "error");
    if (!code.trim()) return toast("请填写角色 code", "error");
    if (!/^[a-z][a-z0-9_]*$/.test(code)) {
      return toast("角色 code 仅允许小写字母 + 数字 + 下划线", "error");
    }
    setSaving(true);
    try {
      const url = isNew
        ? "/api/admin/custom-roles"
        : `/api/admin/custom-roles/${(target as RoleRow).id}`;
      const method = isNew ? "POST" : "PATCH";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          description,
          enabled,
          permissions: Array.from(perms),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d?.error ?? "保存失败", "error");
        return;
      }
      toast(isNew ? "已创建" : "已保存");
      onClose(true);
    } catch {
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={isNew ? "新建自定义角色" : "编辑角色"} onClose={() => onClose()}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] text-gray-600 mb-1 block">角色名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：小组长" />
          </div>
          <div>
            <label className="text-[12px] text-gray-600 mb-1 block">
              角色 code <span className="text-gray-400">（小写字母 + 数字 + 下划线）</span>
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="group_leader"
              disabled={!isNew}
              className={!isNew ? "bg-gray-50 text-gray-500" : ""}
            />
          </div>
        </div>
        <div>
          <label className="text-[12px] text-gray-600 mb-1 block">说明（可选）</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="给同事看的简短描述"
          />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用该角色（停用后已绑定用户立刻失去对应权限）
        </label>

        {isNew && Object.keys(meta.templates).length > 0 && (
          <div className="rounded-[10px] border border-dashed border-gray-200 p-3">
            <p className="text-[12px] text-gray-500 mb-2">从内置模板填充：</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(meta.templates).map(([key, tpl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="text-[12px] px-3 py-1.5 rounded-full bg-gray-50 hover:bg-[#002FA7]/8 text-gray-700 hover:text-[#002FA7] border border-gray-200 transition-colors"
                  title={tpl.description}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {Object.entries(grouped).map(([resource, keys]) => (
          <div key={resource} className="border border-gray-200 rounded-[10px] p-3">
            <p className="text-[13px] font-semibold text-gray-700 mb-2">
              {RESOURCE_LABEL[resource] ?? resource}
              <code className="ml-2 text-[11px] text-gray-400 font-mono font-normal">
                {resource}
              </code>
            </p>
            <div className="space-y-2">
              {(["read", "create", "update"] as const).map((action) => {
                const rowKeys = keys.filter((k) => k.action === action);
                if (rowKeys.length === 0) return null;
                return (
                  <div key={action} className="flex items-center gap-3 flex-wrap">
                    <span className="text-[12px] text-gray-500 w-12 shrink-0">
                      {ACTION_LABEL[action] ?? action}
                    </span>
                    {rowKeys.map((k) => (
                      <label
                        key={k.key}
                        className={
                          "text-[12px] px-3 py-1 rounded-full border cursor-pointer transition-colors " +
                          (perms.has(k.key)
                            ? "bg-[#002FA7] text-white border-[#002FA7]"
                            : "bg-white text-gray-600 border-gray-200 hover:border-[#002FA7]/40")
                        }
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={perms.has(k.key)}
                          onChange={() => toggle(k.key)}
                        />
                        {SCOPE_LABEL[k.scope] ?? k.scope}
                        {k.requiresSuperToGrant && (
                          <span className="ml-1 text-[10px] opacity-70">（限超管）</span>
                        )}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onClose()}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "保存中…" : isNew ? "创建" : "保存"}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── 角色 ↔ 用户 绑定 modal ──────────────────────────────────

function RoleBindUsersModal({
  role,
  onClose,
}: {
  role: RoleRow;
  onClose: (refresh?: boolean) => void;
}) {
  const { toast } = useToast();
  type Binding = { user_id: string; granted_at: string };
  type CandidateUser = {
    id: string;
    username: string | null;
    phone: string;
    role: string;
    nickname?: string | null;
  };

  const [bindings, setBindings] = useState<Binding[]>([]);
  const [userMap, setUserMap] = useState<Record<string, CandidateUser>>({});
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await fetch(`/api/admin/custom-roles/${role.id}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const bs: Binding[] = d.data?.bindings ?? [];
    setBindings(bs);
    if (bs.length > 0) {
      const idsParam = bs.map((b) => b.user_id).join(",");
      try {
        const ur = await fetch(`/api/admin/users?ids=${idsParam}&pageSize=200`, {
          cache: "no-store",
        });
        if (ur.ok) {
          const ud = await ur.json();
          const list: CandidateUser[] = ud.data ?? [];
          const m: Record<string, CandidateUser> = {};
          for (const u of list) m[u.id] = u;
          setUserMap(m);
        }
      } catch {
        // ignore
      }
    } else {
      setUserMap({});
    }
  }, [role.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!search.trim()) {
      setCandidates([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `/api/admin/users?search=${encodeURIComponent(search.trim())}&role=user&pageSize=20`,
          { cache: "no-store" },
        );
        if (r.ok) {
          const d = await r.json();
          setCandidates(d.data ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function grant(userId: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/user-custom-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role_id: role.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(d?.error ?? "授予失败", "error");
        return;
      }
      toast(d.already_granted ? "已存在，未重复添加" : "已授予");
      setSearch("");
      setCandidates([]);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    if (!confirm("确认撤销该用户的此角色？")) return;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/admin/user-custom-roles?user_id=${userId}&role_id=${role.id}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(d?.error ?? "撤销失败", "error");
        return;
      }
      toast("已撤销");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const boundIds = new Set(bindings.map((b) => b.user_id));

  return (
    <ModalShell title={`授予 / 撤销「${role.name}」`} onClose={() => onClose(true)}>
      <div className="space-y-4">
        <p className="text-[12px] text-gray-500">
          角色仅授予 <code className="px-1 bg-gray-100 rounded">role=user</code> 的普通用户。
          内置管理员不挂自定义角色。
        </p>

        <div>
          <label className="text-[12px] text-gray-600 mb-1 block">
            搜索用户（手机号 / 用户名 / 姓名）
          </label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="输入关键字"
              className="pl-9"
            />
          </div>
          {searching && <p className="text-[12px] text-gray-400 mt-1">搜索中…</p>}
          {!searching && candidates.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-[10px] divide-y divide-gray-100 max-h-60 overflow-y-auto">
              {candidates.map((u) => (
                <div
                  key={u.id}
                  className="px-3 py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-800 truncate">
                      {u.nickname ?? u.username ?? u.phone}
                    </p>
                    <p className="text-[11px] text-gray-500">{u.phone}</p>
                  </div>
                  {boundIds.has(u.id) ? (
                    <span className="text-[11px] text-gray-400">已绑定</span>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => grant(u.id)}>
                      授予
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[13px] font-semibold text-gray-700 mb-2">
            已绑定 {bindings.length} 人
          </p>
          {bindings.length === 0 ? (
            <p className="text-[12px] text-gray-400">暂无用户</p>
          ) : (
            <div className="border border-gray-200 rounded-[10px] divide-y divide-gray-100">
              {bindings.map((b) => {
                const u = userMap[b.user_id];
                return (
                  <div
                    key={b.user_id}
                    className="px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-800 truncate">
                        {u?.nickname ?? u?.username ?? u?.phone ?? b.user_id}
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {u?.phone ?? ""} · 授予于 {new Date(b.granted_at).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(b.user_id)}
                      className="text-red-600 hover:bg-red-50"
                    >
                      撤销
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ─── 通用 Modal 壳 ──────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-[14px] shadow-xl w-full max-w-[680px] my-10">
        <div className="flex items-center justify-between px-5 h-12 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
