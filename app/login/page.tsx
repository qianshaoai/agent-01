"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FirstLoginModal } from "@/components/ui/first-login-modal";
import { Eye, EyeOff, Phone, Lock } from "lucide-react";

const LS_LOGIN_KEY = "login_remember_v1";

export default function LoginPage() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFirstLogin, setShowFirstLogin] = useState(false);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "AI 智能体平台" });

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
      if (data.firstLogin) {
        setShowFirstLogin(true);
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#f0f4ff] via-white to-[#f8f9ff]">
      {showFirstLogin && (
        <FirstLoginModal onClose={() => { setShowFirstLogin(false); router.push("/"); router.refresh(); }} />
      )}

      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-[#002FA7]">
            {siteSettings.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-xs font-bold">AI</span>
            )}
          </div>
          <span className="font-semibold text-gray-900 text-sm">
            前哨科技 · {siteSettings.platform_name || "AI 智能体平台"}
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(0,47,167,0.08)] p-8">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">登录</h1>
                <p className="text-sm text-gray-500">欢迎使用 AI 人机协同工作舱</p>
              </div>
              <Link href="/register" className="text-sm text-[#002FA7] hover:underline mt-1 shrink-0">
                注册账号
              </Link>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">手机号 / 用户名</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="请输入手机号或用户名"
                    className="w-full h-11 bg-white border border-gray-200 rounded-[12px] pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
                    value={form.identifier}
                    onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">密码</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={show ? "text" : "password"}
                    placeholder="请输入密码"
                    className="w-full h-11 bg-white border border-gray-200 rounded-[12px] pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 mt-1 rounded-[12px] bg-[#002FA7] text-white font-medium text-sm hover:bg-[#001f7a] transition-colors disabled:opacity-60"
              >
                {loading ? "登录中…" : "登录"}
              </button>

              <p className="text-center text-xs text-gray-400 pt-1">
                如遇问题请联系 <span className="text-gray-500 font-medium">4008189928</span>
              </p>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            © 2026 前哨科技（QianShao.AI）保留所有权利
          </p>
        </div>
      </div>
    </div>
  );
}
