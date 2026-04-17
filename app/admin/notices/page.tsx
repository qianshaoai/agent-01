"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Globe, Building2, Plus, Edit2, Eye, EyeOff, Trash2 } from "lucide-react";

type Notice = { id: string; tenant_code: string | null; content: string; enabled: boolean };
type Tenant = { code: string; name: string };

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [form, setForm] = useState({ type: "global" as "global" | "enterprise", tenantCode: "", content: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [nr, tr] = await Promise.all([
      fetch("/api/admin/notices").then((r) => r.json()).then(d => d.data ?? d),
      fetch("/api/admin/tenants").then((r) => r.json()).then(d => d.data ?? d),
    ]);
    setNotices(Array.isArray(nr) ? nr : []);
    setTenants(Array.isArray(tr) ? tr : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openAdd() { setEditing(null); setForm({ type: "global", tenantCode: "", content: "" }); setShowModal(true); }
  function openEdit(n: Notice) { setEditing(n); setForm({ type: n.tenant_code ? "enterprise" : "global", tenantCode: n.tenant_code ?? "", content: n.content }); setShowModal(true); }

  async function toggleEnabled(n: Notice) {
    await fetch(`/api/admin/notices/${n.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !n.enabled }) });
    load();
  }

  async function deleteNotice(id: string) {
    if (!confirm("确认删除这条公告？")) return;
    await fetch(`/api/admin/notices/${id}`, { method: "DELETE" });
    load();
  }

  async function handleSave() {
    if (!form.content.trim()) return;
    if (form.type === "enterprise" && !form.tenantCode) { alert("请选择组织"); return; }
    setSaving(true);
    try {
      const body = { tenantCode: form.type === "enterprise" ? form.tenantCode : null, content: form.content };
      const res = editing
        ? await fetch(`/api/admin/notices/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/admin/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { setShowModal(false); load(); }
    } finally { setSaving(false); }
  }

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          icon={<Megaphone size={20} />}
          title="公告管理"
          subtitle="全局公告对所有用户可见；组织公告仅对指定组织可见"
          actions={<Button onClick={openAdd} className="gap-2"><Plus size={16} /> 新增公告</Button>}
        />

        {loading ? (
          <div className="space-y-3">{[...Array(2)].map((_, i) => <Card key={i} padding="md"><div className="h-16 bg-gray-50 rounded-[10px] animate-pulse" /></Card>)}</div>
        ) : notices.length === 0 ? (
          <Card padding="lg" className="py-16 text-center text-gray-400"><Megaphone size={36} className="mx-auto mb-3 text-gray-200" /><p className="text-sm">暂无公告</p></Card>
        ) : (
          <div className="space-y-3">
            {notices.map((n) => (
              <Card key={n.id} padding="md" hover className={`transition-opacity ${!n.enabled ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className={`w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0 ${n.tenant_code ? "bg-[#002FA7]/8" : "bg-amber-50"}`}>
                      {n.tenant_code ? <Building2 size={20} className="text-[#002FA7]" /> : <Globe size={20} className="text-amber-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant={n.tenant_code ? "default" : "warning"}>{n.tenant_code ? "组织专属" : "全局公告"}</Badge>
                        {n.tenant_code && <span className="text-[12px] text-gray-500">{tenants.find((t) => t.code === n.tenant_code)?.name ?? n.tenant_code}</span>}
                        <Badge variant={n.enabled ? "success" : "muted"}>{n.enabled ? "已启用" : "已禁用"}</Badge>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">{n.content}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(n)} className="p-2 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑" aria-label="编辑"><Edit2 size={15} /></button>
                    <button onClick={() => toggleEnabled(n)} className="p-2 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title={n.enabled ? "禁用" : "启用"}>{n.enabled ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    <button onClick={() => deleteNotice(n.id)} className="p-2 rounded-[8px] hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="删除" aria-label="删除"><Trash2 size={15} /></button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editing ? "编辑公告" : "新增公告"}</h2>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">公告类型</label>
                <div className="flex gap-4">
                  {(["global", "enterprise"] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="type" value={t} checked={form.type === t} onChange={() => setForm({ ...form, type: t })} className="accent-[#002FA7]" />
                      <span className="text-sm text-gray-700">{t === "global" ? "全局公告" : "组织专属公告"}</span>
                    </label>
                  ))}
                </div>
              </div>
              {form.type === "enterprise" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-gray-700">目标组织</label>
                  <select className="w-full h-11 border border-gray-200 rounded-[12px] px-4 text-sm focus:outline-none focus:border-[#002FA7]" value={form.tenantCode} onChange={(e) => setForm({ ...form, tenantCode: e.target.value })}>
                    <option value="">请选择组织</option>
                    {tenants.map((t) => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">公告内容</label>
                <textarea rows={4} className="w-full border border-gray-200 rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 resize-none" placeholder="请输入公告内容…" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6"><Button variant="ghost" onClick={() => setShowModal(false)}>取消</Button><Button onClick={handleSave} loading={saving}>{editing ? "保存" : "发布"}</Button></div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Megaphone({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m3 11 19-9-9 19-2-8-8-2z" />
    </svg>
  );
}
