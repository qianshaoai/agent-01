"use client";
import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, AlertCircle, Image as ImageIcon, BookOpen } from "lucide-react";

type Settings = { logo_url: string; platform_name: string; help_doc_url: string };

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Settings>({ logo_url: "", platform_name: "", help_doc_url: "" });
  const [name, setName] = useState("");
  const [helpDocUrl, setHelpDocUrl] = useState("");
  const [helpDocSaving, setHelpDocSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((d) => {
        setSettings(d);
        setName(d.platform_name ?? "");
        setHelpDocUrl(d.help_doc_url ?? "");
      })
      .catch(() => {});
  }, []);

  function flash(type: "ok" | "err", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }

  async function saveName() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform_name: name }),
      });
      if (!res.ok) throw new Error();
      setSettings((s) => ({ ...s, platform_name: name }));
      flash("ok", "平台名称已保存");
    } catch {
      flash("err", "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function clearLogo() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo_url: "" }),
      });
      if (!res.ok) throw new Error();
      setSettings((s) => ({ ...s, logo_url: "" }));
      flash("ok", "已恢复默认 Logo");
    } catch {
      flash("err", "操作失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/settings/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "上传失败");
      setSettings((s) => ({ ...s, logo_url: data.url }));
      flash("ok", "Logo 已更新");
    } catch (err: unknown) {
      flash("err", err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">品牌设置</h1>
          <p className="text-sm text-gray-500 mt-1">配置平台 Logo 和名称，变更后全站生效</p>
        </div>

        {msg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-[10px] text-sm ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {msg.type === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {msg.text}
          </div>
        )}

        {/* Logo 配置 */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">平台 Logo</h2>
          <p className="text-xs text-gray-500 mb-5">
            建议上传 <strong>1:1 正方形</strong> Logo · 推荐尺寸 <strong>256 × 256 px</strong> · 格式 <strong>PNG / SVG</strong> · 建议透明背景
          </p>

          <div className="flex items-center gap-6">
            {/* 预览区 */}
            <div className="shrink-0">
              <p className="text-xs text-gray-400 mb-2 text-center">当前效果</p>
              <div className="w-10 h-10 rounded-[10px] overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center">
                {settings.logo_url ? (
                  <img
                    src={settings.logo_url}
                    alt="Logo"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full bg-[#002FA7] flex items-center justify-center">
                    <span className="text-white text-xs font-bold">AI</span>
                  </div>
                )}
              </div>
            </div>

            {/* 操作区 */}
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,.webp"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                size="sm"
                onClick={() => fileRef.current?.click()}
                loading={uploading}
                className="flex items-center gap-1.5"
              >
                <Upload size={14} />
                {uploading ? "上传中…" : "上传新 Logo"}
              </Button>
              {settings.logo_url && (
                <button
                  onClick={clearLogo}
                  disabled={saving}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors text-left"
                >
                  恢复默认 AI 图标
                </button>
              )}
              {!settings.logo_url && (
                <p className="flex items-center gap-1 text-xs text-gray-400">
                  <ImageIcon size={12} />
                  当前使用默认 AI 图标
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 平台名称 */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">平台名称</h2>
          <p className="text-xs text-gray-500 mb-5">显示在页头左上角和登录页，留空则使用默认名称</p>

          <div className="flex gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="AI 智能体平台"
              className="flex-1 h-10 bg-white border border-gray-200 rounded-[10px] px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
            />
            <Button size="sm" onClick={saveName} loading={saving} disabled={name === settings.platform_name}>
              保存
            </Button>
          </div>
          {settings.platform_name && name !== settings.platform_name && (
            <p className="mt-2 text-xs text-amber-600">有未保存的修改</p>
          )}
        </div>

        {/* 帮助文档 */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <BookOpen size={15} className="text-[#002FA7]" /> 帮助文档链接
          </h2>
          <p className="text-xs text-gray-500 mb-5">配置后用户端顶部会显示「帮助文档」按钮，点击在新标签页打开。支持飞书文档、语雀等任意 URL，留空则不显示按钮。</p>

          <div className="flex gap-3">
            <input
              type="url"
              value={helpDocUrl}
              onChange={(e) => setHelpDocUrl(e.target.value)}
              placeholder="https://xxx.feishu.cn/docx/..."
              className="flex-1 h-10 bg-white border border-gray-200 rounded-[10px] px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
            />
            <Button
              size="sm"
              loading={helpDocSaving}
              disabled={helpDocUrl === settings.help_doc_url}
              onClick={async () => {
                setHelpDocSaving(true);
                try {
                  const res = await fetch("/api/admin/settings", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ help_doc_url: helpDocUrl }),
                  });
                  if (!res.ok) throw new Error();
                  setSettings((s) => ({ ...s, help_doc_url: helpDocUrl }));
                  flash("ok", "帮助文档链接已保存");
                } catch {
                  flash("err", "保存失败，请重试");
                } finally {
                  setHelpDocSaving(false);
                }
              }}
            >
              保存
            </Button>
          </div>
          {helpDocUrl !== settings.help_doc_url && (
            <p className="mt-2 text-xs text-amber-600">有未保存的修改</p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
