"use client";
// 6.5up · 标签管理独立页（智能体标签 + 工作流标签）
//
// 路线 A：不动数据层 / API（仍叫 categories / wf-categories），仅前端文案统一为「标签」。
// 本页面把 agents/page.tsx 与 workflows/page.tsx 的"分类管理 Tab"整体搬过来 + 2 Tab 包装。
//
// 权限：super_admin + system_admin（与 isTagAdmin 服务端拦截一致）；
// 页面级 guard 必须等 /api/admin/me 返回 role 再判断，避免初始 null 误跳 dashboard。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tag, Plus, Pencil, Check, X, Image as ImageIcon, Building2, Trash2, CheckCircle2 } from "lucide-react";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";
import { isTagAdmin, type AdminRole } from "@/lib/admin-permissions";

type Category = { id: string; name: string; icon_url?: string | null };
type Tenant = { id: string; code: string; name: string };

export default function TagsAdminPage() {
  const { toast } = useToast();
  const router = useRouter();

  // ─── 页面级 guard ──────────────────────────────────────────
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.role) setAdminRole(d.role as AdminRole);
      })
      .catch(() => {})
      .finally(() => setMeLoaded(true));
  }, []);
  useEffect(() => {
    if (!meLoaded) return; // 必须等 me 返回，否则 adminRole=null 会误跳
    if (!isTagAdmin(adminRole)) {
      router.replace("/admin/dashboard");
      toast("无权访问标签管理");
    }
  }, [meLoaded, adminRole, router, toast]);

  // ─── Tab 切换（URL ?tab=workflow 可深链） ─────────────────
  const [tab, setTab] = useState<"agent" | "workflow">("agent");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("tab") === "workflow") setTab("workflow");
  }, []);

  // ─── 数据加载 ────────────────────────────────────────────
  const [agentTags, setAgentTags] = useState<Category[]>([]);
  const [wfTags, setWfTags] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [a, w, t] = await Promise.all([
        fetch("/api/admin/categories").then((r) => r.json()).then((d) => d.data ?? d),
        fetch("/api/admin/wf-categories").then((r) => r.json()).then((d) => d.data ?? d),
        fetch("/api/admin/tenants").then((r) => r.json()).then((d) => d.data ?? d),
      ]);
      setAgentTags(Array.isArray(a) ? a : []);
      setWfTags(Array.isArray(w) ? w : []);
      setTenants(Array.isArray(t) ? t : []);
    } catch {
      setAgentTags([]);
      setWfTags([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (meLoaded && isTagAdmin(adminRole)) load();
  }, [meLoaded, adminRole]);

  // ─── 共享：新增 / 编辑 state ──────────────────────────────
  const [newName, setNewName] = useState("");
  const [nameHint, setNameHint] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const addGuard = useSubmitGuard();

  function resetEdit() {
    setEditingId(null);
    setEditingName("");
  }

  // ─── 智能体标签 · CRUD（调 /api/admin/categories） ────────
  async function addAgentTag() {
    if (!newName.trim()) {
      setNameHint("请输入标签名称");
      return;
    }
    await addGuard.submit(async (idempotencyKey) => {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d.error ?? "添加失败");
        return;
      }
      setNewName("");
      load();
    });
  }
  async function saveAgentTagEdit(id: string) {
    const newN = editingName.trim();
    if (!newN) return;
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newN }),
    });
    if (res.ok) setAgentTags((prev) => prev.map((c) => (c.id === id ? { ...c, name: newN } : c)));
    resetEdit();
  }
  async function uploadAgentTagIcon(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/categories/${id}/icon`, { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setAgentTags((prev) => prev.map((c) => (c.id === id ? { ...c, icon_url: data.url } : c)));
    } else {
      const d = await res.json();
      alert(d.error ?? "图标上传失败");
    }
    e.target.value = "";
  }
  async function removeAgentTagIcon(id: string) {
    if (!confirm("确认删除此标签的图标？")) return;
    const res = await fetch(`/api/admin/categories/${id}/icon`, { method: "DELETE" });
    if (res.ok) setAgentTags((prev) => prev.map((c) => (c.id === id ? { ...c, icon_url: null } : c)));
  }

  // ─── 智能体标签 · 组织分配 modal ──────────────────────────
  const [assignTarget, setAssignTarget] = useState<Category | null>(null);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const assignGuard = useSubmitGuard();
  async function openAssign(cat: Category) {
    setAssignTarget(cat);
    const data = await fetch(`/api/admin/categories/${cat.id}`).then((r) => r.json()).catch(() => ({}));
    setSelectedTenants(data.tenant_codes ?? []);
  }
  async function handleAssign() {
    if (!assignTarget) return;
    await assignGuard.submit(async () => {
      await fetch(`/api/admin/categories/${assignTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantCodes: selectedTenants }),
      });
      setAssignTarget(null);
    });
  }

  // ─── 工作流标签 · CRUD（调 /api/admin/wf-categories） ─────
  async function addWfTag() {
    if (!newName.trim()) {
      setNameHint("请输入标签名称");
      return;
    }
    await addGuard.submit(async (idempotencyKey) => {
      const res = await fetch("/api/admin/wf-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d.error ?? "添加失败");
        return;
      }
      setNewName("");
      load();
    });
  }
  async function saveWfTagEdit(id: string) {
    if (!editingName.trim()) return;
    await fetch(`/api/admin/wf-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editingName.trim() }),
    });
    resetEdit();
    load();
  }
  async function deleteWfTag(cat: Category) {
    if (!confirm(`确认删除标签「${cat.name}」？`)) return;
    const res = await fetch(`/api/admin/wf-categories/${cat.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "删除失败");
      return;
    }
    load();
  }
  async function uploadWfTagIcon(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/admin/wf-categories/${id}/icon`, { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      setWfTags((prev) => prev.map((c) => (c.id === id ? { ...c, icon_url: data.url } : c)));
    } else {
      const d = await res.json();
      alert(d.error ?? "图标上传失败");
    }
    e.target.value = "";
  }
  async function removeWfTagIcon(id: string) {
    if (!confirm("确认删除此标签的图标？")) return;
    const res = await fetch(`/api/admin/wf-categories/${id}/icon`, { method: "DELETE" });
    if (res.ok) setWfTags((prev) => prev.map((c) => (c.id === id ? { ...c, icon_url: null } : c)));
  }

  // ─── 渲染兜底（meLoaded 之前 / 无权时） ──────────────────
  if (!meLoaded) return null;
  if (!isTagAdmin(adminRole)) return null; // guard effect 会跳走

  const tags = tab === "agent" ? agentTags : wfTags;
  const onAdd = tab === "agent" ? addAgentTag : addWfTag;
  const onSaveEdit = tab === "agent" ? saveAgentTagEdit : saveWfTagEdit;
  const onUploadIcon = tab === "agent" ? uploadAgentTagIcon : uploadWfTagIcon;
  const onRemoveIcon = tab === "agent" ? removeAgentTagIcon : removeWfTagIcon;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <PageHeader
          icon={<Tag size={20} />}
          title="标签管理"
          subtitle="管理智能体与工作流的标签"
          badge={<span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">共 {agentTags.length + wfTags.length} 个</span>}
          actions={
            <div className="flex gap-1 p-1 bg-gray-100/70 rounded-[10px]">
              {(["agent", "workflow"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setNewName("");
                    setNameHint("");
                    resetEdit();
                  }}
                  className={`px-3.5 py-1.5 rounded-[8px] text-[13px] font-medium transition-all ${
                    tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t === "agent" ? "智能体标签" : "工作流标签"}
                </button>
              ))}
            </div>
          }
        />

        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <input
              className={`flex-1 h-10 border rounded-[10px] px-4 text-sm focus:outline-none transition-colors ${
                nameHint
                  ? "border-red-400 placeholder:text-red-500 focus:border-red-500"
                  : "border-gray-200 focus:border-[#002FA7]"
              }`}
              placeholder={nameHint || "新标签名称…"}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (nameHint) setNameHint("");
              }}
              onFocus={() => {
                if (nameHint) setNameHint("");
              }}
              onKeyDown={(e) => e.key === "Enter" && onAdd()}
            />
            <Button size="sm" onClick={onAdd} loading={addGuard.loading} className="gap-1">
              <Plus size={14} /> 添加
            </Button>
          </div>

          <div className="space-y-2">
            {loading ? (
              <p className="text-sm text-gray-400 text-center py-6">加载中…</p>
            ) : tags.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">暂无标签，在上方输入名称后回车或点击添加</p>
            ) : (
              tags.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-[12px]">
                  {editingId === cat.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Tag size={15} className="text-[#002FA7] shrink-0" />
                      <input
                        autoFocus
                        className="flex-1 h-9 border border-[#002FA7]/40 rounded-[8px] px-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onSaveEdit(cat.id);
                          if (e.key === "Escape") resetEdit();
                        }}
                      />
                      <button onClick={() => onSaveEdit(cat.id)} className="p-1.5 rounded-[6px] bg-[#002FA7] text-white hover:bg-[#002FA7]/90 transition-colors" title="确认" aria-label="确认">
                        <Check size={13} />
                      </button>
                      <button onClick={resetEdit} className="p-1.5 rounded-[6px] hover:bg-gray-200 text-gray-400 transition-colors" title="取消" aria-label="取消">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        {cat.icon_url ? (
                          <div className="w-8 h-8 rounded-[8px] overflow-hidden bg-white border border-gray-200 flex items-center justify-center">
                            {/* 用户上传图标，URL 动态不在 next/image remotePatterns 内 */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={cat.icon_url} alt={cat.name} className="w-full h-full object-contain" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-[8px] bg-[#002FA7]/8 flex items-center justify-center">
                            <Tag size={15} className="text-[#002FA7]" />
                          </div>
                        )}
                        <span className="font-medium text-gray-800">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <label
                          className="p-1.5 rounded-[8px] hover:bg-[#002FA7]/10 text-gray-400 hover:text-[#002FA7] transition-colors cursor-pointer"
                          title={cat.icon_url ? "替换图标" : "上传图标"}
                        >
                          <input
                            type="file"
                            accept=".png,.jpg,.jpeg,.svg,.webp"
                            className="hidden"
                            onChange={(e) => onUploadIcon(cat.id, e)}
                          />
                          <ImageIcon size={13} />
                        </label>
                        {cat.icon_url && (
                          <button onClick={() => onRemoveIcon(cat.id)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除图标" aria-label="删除图标">
                            <X size={13} />
                          </button>
                        )}
                        {tab === "agent" && (
                          <button onClick={() => openAssign(cat)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="组织分配" aria-label="组织分配">
                            <Building2 size={13} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingId(cat.id);
                            setEditingName(cat.name);
                          }}
                          className="p-1.5 rounded-[8px] hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                          title="编辑"
                          aria-label="编辑"
                        >
                          <Pencil size={13} />
                        </button>
                        {tab === "workflow" && (
                          <button onClick={() => deleteWfTag(cat)} className="p-1.5 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除" aria-label="删除">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* 智能体标签 · 组织分配 modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-1">组织分配</h2>
            <p className="text-sm text-gray-500 mb-2">{assignTarget.name} — 选择可以看到此标签的组织</p>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setSelectedTenants(tenants.map((t) => t.code))} className="text-xs text-[#002FA7] hover:underline">
                一键全选
              </button>
              <span className="text-gray-300">·</span>
              <button onClick={() => setSelectedTenants([])} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                全部取消
              </button>
              <span className="ml-auto text-xs text-gray-400">
                已选 {selectedTenants.length} / {tenants.length}
              </span>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {tenants.map((t) => (
                <label key={t.code} className="flex items-center gap-3 p-3 bg-gray-50 rounded-[10px] cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    className="accent-[#002FA7] w-4 h-4"
                    checked={selectedTenants.includes(t.code)}
                    onChange={(e) =>
                      setSelectedTenants((prev) =>
                        e.target.checked ? [...prev, t.code] : prev.filter((c) => c !== t.code)
                      )
                    }
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{t.name}</p>
                    <code className="text-xs text-gray-400 font-mono">{t.code}</code>
                  </div>
                  {selectedTenants.includes(t.code) && <CheckCircle2 size={15} className="text-[#002FA7] ml-auto" />}
                </label>
              ))}
              {tenants.length === 0 && <p className="text-sm text-gray-400 text-center py-4">暂无组织，请先新增</p>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setAssignTarget(null)}>
                取消
              </Button>
              <Button onClick={handleAssign} loading={assignGuard.loading}>
                保存分配
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
