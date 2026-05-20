"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { FirstLoginModal } from "@/components/ui/first-login-modal";
import { Eye, EyeOff, Phone, Lock, X, QrCode } from "lucide-react";

const LS_LOGIN_KEY = "login_remember_v1";

export default function LoginPage() {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [siteSettings, setSiteSettings] = useState({
    logo_url: "",
    platform_name: "AI 智能体平台",
    help_doc_url: "",
    contact_qr_url: "",
    contact_qr_text: "扫码添加微信，获取专属服务",
    login_showcase_url: "",
  });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setSiteSettings(d)).catch(() => {});
    try {
      const saved = localStorage.getItem(LS_LOGIN_KEY);
      if (saved) {
        const { identifier, phone } = JSON.parse(saved);
        setForm((f) => ({ ...f, identifier: identifier ?? phone ?? "" }));
      }
    } catch {}
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.identifier || !form.password) {
      setError("请填写账号和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: form.identifier, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        return;
      }
      try {
        localStorage.setItem(LS_LOGIN_KEY, JSON.stringify({ identifier: form.identifier }));
      } catch {}
      if (data.userType === "trial") {
        window.location.href = "/trial";
        return;
      }
      if (data.firstLogin) {
        setShowFirstLogin(true);
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background:
          "radial-gradient(ellipse 110% 90% at 50% 50%, #eef0ff 0%, #c5d0ff 22%, #4a63c4 48%, #0f1f5a 75%, #050b30 100%)",
      }}
    >
      {showFirstLogin && (
        <FirstLoginModal onClose={() => { setShowFirstLogin(false); window.location.href = "/"; }} />
      )}

      {/* 顶栏 · 落在渐变暗区 */}
      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-white/10 border border-white/15">
              {siteSettings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <span className="text-white text-xs font-bold">AI</span>
              )}
            </div>
            <span className="font-semibold text-white text-[15px]">
              {siteSettings.platform_name || "AI 智能体平台"}
            </span>
          </div>

          <div className="flex items-center gap-5">
            <button
              onClick={() => setContactOpen(true)}
              className="text-sm text-white/70 hover:text-white transition-colors"
            >
              联系我们
            </button>
            <Link
              href="/register"
              className="text-sm text-white hover:text-white/85 font-medium transition-colors"
            >
              注册账号
            </Link>
          </div>
        </div>
      </header>

      {/* 表单主区 · 大卡片：左侧 showcase + 右侧登录 */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[960px]">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#001f7a]/85 via-[#002FA7]/82 to-[#3b5fff]/80 backdrop-blur-md shadow-[0_24px_60px_rgba(0,15,80,0.45)] border border-white/15 flex">
            {/* 左侧 showcase · 占 1.8 份（后台可上传图片，未配置时回退纯色） */}
            <div className="hidden md:block flex-[9] bg-[#001f7a] relative border-r border-white/10">
              {siteSettings.login_showcase_url && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={siteSettings.login_showcase_url}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {/* 15% 黑色叠层 · 压亮度让画面与右侧深蓝表单更协调 */}
                  <div className="absolute inset-0 bg-black/15 pointer-events-none" />
                </>
              )}
            </div>

            {/* 右侧登录表单 · 占 1 份（登录 : 展示 = 1 : 1.8） */}
            <div className="flex-[5] relative overflow-hidden px-7 py-10">
              {/* 角落淡蓝光晕 */}
              <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-[#bdd4ff]/45 blur-[60px] pointer-events-none" />
              <div className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#a4c4ff]/40 blur-[70px] pointer-events-none" />
              {/* 顶部高光线 */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
              {/* 左上柔光叠层 */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

              <div className="relative">
                <div className="mb-8">
                  <h1 className="text-2xl font-bold text-white mb-1">登录</h1>
                  <p className="text-sm text-white/65">欢迎使用 AI 人机协同工作舱</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">手机号 / 用户名</label>
                  <div className="relative">
                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                      type="text"
                      placeholder="请输入手机号或用户名"
                      className="w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-4 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all"
                      value={form.identifier}
                      onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">密码</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                      type={show ? "text" : "password"}
                      placeholder="请输入密码"
                      className="w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-500/15 border border-red-400/30 rounded-[10px] text-sm text-red-200">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 mt-3 rounded-[12px] bg-white text-[#001f7a] font-semibold text-sm hover:bg-white/90 active:bg-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "登录中…" : "登录"}
                </button>

                <p className="text-center text-xs text-white/65 pt-1">
                  还没账号？
                  <Link href="/register" className="text-white font-medium hover:underline ml-0.5">
                    立即注册
                  </Link>
                </p>

                <p className="text-center text-xs text-white/55 pt-1">
                  如遇问题请联系 <span className="text-white/80 font-medium">4008189928</span>
                </p>
              </form>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-white/70 mt-6">
            © 2026 前哨科技（QianShao.AI）保留所有权利
          </p>
        </div>
      </main>

      {/* 联系我们 modal */}
      {contactOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setContactOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="联系我们"
        >
          <div
            className="bg-white rounded-[20px] p-8 shadow-2xl flex flex-col items-center gap-4 w-72 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setContactOpen(false)}
              className="absolute top-3 right-3 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
            <h3 className="font-semibold text-gray-900">联系我们</h3>
            <div className="w-40 h-40 bg-gray-100 rounded-[12px] flex items-center justify-center overflow-hidden">
              {siteSettings.contact_qr_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={siteSettings.contact_qr_url}
                  alt="联系二维码"
                  className="w-full h-full object-contain"
                />
              ) : (
                <QrCode size={64} className="text-gray-300" />
              )}
            </div>
            {siteSettings.contact_qr_text && (
              <p className="text-xs text-gray-500 text-center">{siteSettings.contact_qr_text}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
