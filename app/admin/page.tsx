"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Lock, KeyRound } from "lucide-react";

// 5.28up · 后台登录 UI 向用户端登录靠拢：
//   - 深蓝径向渐变背景（同 /login）
//   - 顶栏放 logo + 平台名（同 /login，去掉注册 / 联系我们入口）
//   - 居中玻璃卡（白字 + 半透明输入框；与 /login 右侧表单同款）
//   - **不放 showcase 图**（用户决策：后台登录页只要登录）
//   - 业务逻辑完全沿用：mustChange 首次改密码 / 错误提示 / loading / 自动跳 dashboard

export default function AdminLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "AI 智能体平台" });

  // 强制改密码流程
  const [mustChange, setMustChange] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [newPwdConfirm, setNewPwdConfirm] = useState("");
  const [changeError, setChangeError] = useState("");
  const [changeLoading, setChangeLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setSiteSettings(d)).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.username || !form.password) {
      setError("请填写用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败");
        return;
      }
      // 后端提示需要先修改密码
      if (data.mustChangePassword) {
        setMustChange(true);
        return;
      }
      // 6.4up 验收修复 · custom admin 的权限通道不含控制台（dashboard 4 个接口走
      //   builtin-only requireAdmin → 401 → 旧 dashboard 崩页）。改落地到它真正能进的
      //   工作流管理；无 workflow 权限时该页 + admin-layout 会显示"尚未配置后台权限"兜底。
      router.push(data.source === "custom_admin" ? "/admin/workflows" : "/admin/dashboard");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangeError("");
    if (newPwd.length < 8) {
      setChangeError("新密码至少 8 位");
      return;
    }
    if (newPwd === form.password) {
      setChangeError("新密码不能与初始密码相同");
      return;
    }
    if (newPwd !== newPwdConfirm) {
      setChangeError("两次输入的密码不一致");
      return;
    }
    setChangeLoading(true);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: form.password, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChangeError(data.error ?? "修改失败");
        return;
      }
      router.push("/admin/dashboard");
      router.refresh();
    } catch {
      setChangeError("网络错误，请重试");
    } finally {
      setChangeLoading(false);
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
      {/* 顶栏 · 与 /login 同款，去掉注册 / 联系我们 */}
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

          <div className="text-xs text-white/55 font-medium tracking-wide">管理后台</div>
        </div>
      </header>

      {/* 表单主区 · 居中玻璃卡（窄一些，因为没有 showcase） */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#001f7a]/85 via-[#002FA7]/82 to-[#3b5fff]/80 backdrop-blur-md shadow-[0_24px_60px_rgba(0,15,80,0.45)] border border-white/15 px-7 py-10">
            {/* 角落淡蓝光晕 · 与 /login 一致 */}
            <div className="absolute -top-24 -right-20 w-56 h-56 rounded-full bg-[#bdd4ff]/45 blur-[60px] pointer-events-none" />
            <div className="absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#a4c4ff]/40 blur-[70px] pointer-events-none" />
            {/* 顶部高光线 */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
            {/* 左上柔光叠层 */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

            <div className="relative">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-white mb-1">
                  {mustChange ? "首次登录 · 修改密码" : "管理员登录"}
                </h1>
                <p className="text-sm text-white/65">
                  {mustChange
                    ? "修改成功后将自动进入后台"
                    : "登录后进入平台管理后台"}
                </p>
              </div>

              {!mustChange ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/85">管理员账号</label>
                    <div className="relative">
                      <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                      <input
                        type="text"
                        placeholder="请输入用户名"
                        className="w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-4 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all"
                        value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
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
                    <div className="p-3 bg-red-500/15 border border-red-400/30 rounded-[10px] text-sm text-red-200">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 mt-3 rounded-[12px] bg-white text-[#001f7a] font-semibold text-sm hover:bg-white/90 active:bg-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "登录中…" : "登录管理后台"}
                  </button>

                  <p className="text-center text-xs text-white/55 pt-1">
                    如遇问题请联系 <span className="text-white/80 font-medium">4008189928</span>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleChangePassword} className="space-y-6">
                  <div className="p-3 bg-amber-400/10 border border-amber-300/30 rounded-[10px] text-[13px] text-amber-100 flex items-start gap-2">
                    <KeyRound size={15} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">首次登录需修改初始密码</p>
                      <p className="text-[12px] text-amber-200/85 mt-0.5">修改成功后将自动进入后台</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/85">新密码（至少 8 位）</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                      <input
                        type="password"
                        placeholder="请输入新密码"
                        className="w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-4 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all"
                        value={newPwd}
                        onChange={(e) => { setNewPwd(e.target.value); setChangeError(""); }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/85">确认新密码</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                      <input
                        type="password"
                        placeholder="再次输入新密码"
                        className="w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-4 text-sm text-white placeholder:text-white/45 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all"
                        value={newPwdConfirm}
                        onChange={(e) => { setNewPwdConfirm(e.target.value); setChangeError(""); }}
                      />
                    </div>
                  </div>

                  {changeError && (
                    <div className="p-3 bg-red-500/15 border border-red-400/30 rounded-[10px] text-sm text-red-200">
                      {changeError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={changeLoading}
                    className="w-full h-12 mt-3 rounded-[12px] bg-white text-[#001f7a] font-semibold text-sm hover:bg-white/90 active:bg-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {changeLoading ? "提交中…" : "确认修改并进入后台"}
                  </button>
                </form>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-white/70 mt-6">
            © 2026 前哨科技（QianShao.AI）保留所有权利
          </p>
        </div>
      </main>
    </div>
  );
}
