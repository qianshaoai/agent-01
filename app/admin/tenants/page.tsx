"use client";
import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit2, Ban, Calendar, Zap, CheckCircle2, Building2 } from "lucide-react";

type Tenant = {
  id: string;
  code: string;
  name: string;
  quota: number;
  quota_used: number;
  expires_at: string;
  enabled: boolean;
};

const EMPTY_FORM = { code: "", name: "", initialPwd: "", quota: "500", expiresAt: "" };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/tenants");
    if (res.ok) setTenants(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = tenants.filter(
    (t) => t.code.toLowerCase().includes(search.toLowerCase()) || t.name.includes(search)
  );

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowModal(true);
  }

  function openEdit(t: Tenant) {
    setEditing(t);
    setForm({ code: t.code, name: t.name, initialPwd: "", quota: String(t.quota), expiresAt: t.expires_at });
    setFormError("");
    setShowModal(true);
  }

  async function toggleEnabled(t: Tenant) {
    await fetch(`/api/admin/tenants/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    load();
  }

  async function handleSave() {
    setFormError("");
    if (!form.name || !form.quota || !form.expiresAt) {
      setFormError("请填写企业名称、配额和到期日");
      return;
    }
    if (!editing && (!form.code || !form.initialPwd)) {
      setFormError("新建时请填写企业码和初始密码");
      return;
    }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/tenants/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: form.name, quota: form.quota, expiresAt: form.expiresAt, initialPwd: form.initialPwd || undefined }),
          })
        : await fetch("/api/admin/tenants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: form.code, name: form.name, initialPwd: form.initialPwd, quota: form.quota, expiresAt: form.expiresAt }),
          });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "保存失败"); return; }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">企业码管理</h1>
            <p className="text-sm text-gray-500 mt-0.5">共 {tenants.length} 家企业</p>
          </div>
          <Button onClick={openAdd} className="gap-2"><Plus size={16} /> 新增企业码</Button>
        </div>

        <div className="relative max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="w-full h-10 pl-9 pr-4 bg-white border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10" placeholder="搜索企业名称或企业码…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-[10px] animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <Building2 size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="text-sm">{search ? "没有匹配的企业" : "暂无企业，点击右上角新增"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    {["企业码", "企业名称", "配额", "到期日", "状态", "操作"].map((h) => (
                      <th key={h} className="px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((t) => {
                    const pct = Math.round((t.quota_used / t.quota) * 100);
                    const expired = new Date(t.expires_at) < new Date();
                    return (
                      <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <code className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-[6px] text-xs font-mono">{t.code}</code>
                        </td>
                        <td className="px-5 py-4 font-medium text-gray-800">{t.name}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <Zap size={12} className="text-amber-500 shrink-0" />
                            <div>
                              <p className={`text-xs font-medium ${pct >= 100 ? "text-red-500" : "text-gray-700"}`}>{t.quota_used}/{t.quota} 次</p>
                              <div className="w-20 h-1.5 bg-gray-100 rounded-full mt-1">
                                <div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-[#002FA7]"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5">
                            <Calendar size={12} className="text-gray-400" />
                            <span className={`text-sm ${expired ? "text-red-500 font-medium" : "text-gray-600"}`}>{t.expires_at}</span>
                            {expired && <Badge variant="danger">已到期</Badge>}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={t.enabled ? "success" : "muted"}>{t.enabled ? "启用" : "禁用"}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEdit(t)} className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="编辑"><Edit2 size={14} /></button>
                            <button onClick={() => toggleEnabled(t)} className={`p-1.5 rounded-[8px] transition-colors ${t.enabled ? "hover:bg-red-50 text-gray-400 hover:text-red-500" : "hover:bg-green-50 text-gray-400 hover:text-green-500"}`} title={t.enabled ? "禁用" : "启用"}>{t.enabled ? <Ban size={14} /> : <CheckCircle2 size={14} />}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-md p-6">
            <h2 className="font-semibold text-gray-900 mb-5">{editing ? "编辑企业码" : "新增企业码"}</h2>
            <div className="space-y-4">
              <Input label="企业码（自动转大写）" placeholder="如 COMPANY2024" value={form.code} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              <Input label="企业名称" placeholder="如 前哨科技有限公司" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label={editing ? "企业初始密码（留空不修改）" : "企业初始密码"} type="password" placeholder={editing ? "留空则不修改" : "设置初始密码"} value={form.initialPwd} onChange={(e) => setForm({ ...form, initialPwd: e.target.value })} />
              <Input label="总配额（次数）" type="number" placeholder="500" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} />
              <Input label="到期日" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              {formError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{formError}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setShowModal(false)}>取消</Button>
              <Button onClick={handleSave} loading={saving}>{editing ? "保存修改" : "创建"}</Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
