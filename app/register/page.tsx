"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Phone, Lock, Building2, User, UserCheck } from "lucide-react";

type UserType = "personal" | "organization";

// 5.16up R2 · 注册页视觉同步登录页：深蓝渐变背景 + 深蓝玻璃卡片（单卡片，无 showcase 图）
const inputCls =
  "w-full h-11 bg-white/10 border border-white/20 rounded-[12px] pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/60 focus:bg-white/15 focus:ring-2 focus:ring-white/15 transition-all";

function FieldIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none">
      {icon}
    </span>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [userType, setUserType] = useState<UserType>("personal");
  const [form, setForm] = useState({
    username: "",
    realName: "",
    phone: "",
    password: "",
    confirmPwd: "",
    tenantCode: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [siteSettings, setSiteSettings] = useState({ logo_url: "", platform_name: "AI 智能体平台" });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => setSiteSettings(d)).catch(() => {});
  }, []);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.username.trim()) { setError("请填写用户名"); return; }
    if (!form.realName.trim()) { setError("请填写真实姓名"); return; }
    if (!form.phone.trim()) { setError("请填写手机号"); return; }
    if (!form.password) { setError("请填写密码"); return; }
    if (form.password.length < 8) { setError("密码至少 8 位"); return; }
    if (form.password !== form.confirmPwd) { setError("两次密码输入不一致"); return; }
    if (userType === "organization") {
      if (!form.tenantCode.trim()) { setError("组织用户必须填写组织码"); return; }
      if (!/^[A-Za-z]{4,8}$/.test(form.tenantCode.trim())) {
        setError("组织码只能为 4~8 位英文字母");
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userType,
          username: form.username.trim(),
          realName: form.realName.trim(),
          phone: form.phone.trim(),
          password: form.password,
          tenantCode: form.tenantCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "注册失败");
        return;
      }
      router.push("/");
      router.refresh();
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
      {/* 顶栏 · 与登录页一致 */}
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

          <Link
            href="/login"
            className="text-sm text-white hover:text-white/85 font-medium transition-colors"
          >
            已有账号，去登录
          </Link>
        </div>
      </header>

      {/* 表单主区 · 单卡片居中 */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[460px]">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#001f7a]/85 via-[#002FA7]/82 to-[#3b5fff]/80 backdrop-blur-md shadow-[0_24px_60px_rgba(0,15,80,0.45)] border border-white/15 px-7 py-9">
            {/* 顶部高光线 */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />
            {/* 左上柔光叠层 */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent pointer-events-none" />

            <div className="relative">
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-white mb-1">创建账号</h1>
                <p className="text-sm text-white/65">填写信息完成注册，注册后自动登录</p>
              </div>

              {/* 用户类型切换 · 深蓝底玻璃态分段控件 */}
              <div className="flex gap-1 mb-6 p-1 bg-white/10 border border-white/15 rounded-[12px]">
                <button
                  type="button"
                  onClick={() => { setUserType("personal"); setError(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-sm font-medium transition-all ${
                    userType === "personal"
                      ? "bg-white shadow-sm text-[#001f7a]"
                      : "text-white/60 hover:text-white/85"
                  }`}
                >
                  <User size={14} /> 个人用户
                </button>
                <button
                  type="button"
                  onClick={() => { setUserType("organization"); setError(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-sm font-medium transition-all ${
                    userType === "organization"
                      ? "bg-white shadow-sm text-[#001f7a]"
                      : "text-white/60 hover:text-white/85"
                  }`}
                >
                  <Building2 size={14} /> 组织用户
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 用户名 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">用户名</label>
                  <div className="relative">
                    <FieldIcon icon={<User size={16} />} />
                    <input
                      className={inputCls}
                      placeholder="3~20 位字母、数字或下划线"
                      value={form.username}
                      onChange={(e) => set("username", e.target.value)}
                      autoComplete="username"
                    />
                  </div>
                </div>

                {/* 真实姓名 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">真实姓名</label>
                  <div className="relative">
                    <FieldIcon icon={<UserCheck size={16} />} />
                    <input
                      className={inputCls}
                      placeholder="请输入真实姓名"
                      value={form.realName}
                      onChange={(e) => set("realName", e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>

                {/* 手机号 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">手机号</label>
                  <div className="relative">
                    <FieldIcon icon={<Phone size={16} />} />
                    <input
                      type="tel"
                      className={inputCls}
                      placeholder="请输入手机号"
                      value={form.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      autoComplete="tel"
                    />
                  </div>
                </div>

                {/* 组织码（组织用户） */}
                {userType === "organization" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-white/85">组织码</label>
                    <div className="relative">
                      <FieldIcon icon={<Building2 size={16} />} />
                      <input
                        className={inputCls}
                        placeholder="4~8 位英文字母"
                        value={form.tenantCode}
                        onChange={(e) => set("tenantCode", e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8))}
                        autoComplete="off"
                      />
                    </div>
                    <p className="text-xs text-white/45">组织码由管理员提供，4~8 位英文字母</p>
                  </div>
                )}

                {/* 密码 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">密码</label>
                  <div className="relative">
                    <FieldIcon icon={<Lock size={16} />} />
                    <input
                      type={showPwd ? "text" : "password"}
                      className={`${inputCls} pr-10`}
                      placeholder="至少 8 位"
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                      onClick={() => setShowPwd(!showPwd)}
                    >
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* 确认密码 */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-white/85">确认密码</label>
                  <div className="relative">
                    <FieldIcon icon={<Lock size={16} />} />
                    <input
                      type={showConfirm ? "text" : "password"}
                      className={`${inputCls} pr-10`}
                      placeholder="再次输入密码"
                      value={form.confirmPwd}
                      onChange={(e) => set("confirmPwd", e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                      onClick={() => setShowConfirm(!showConfirm)}
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-500/15 border border-red-400/30 rounded-[10px] text-sm text-red-200">{error}</div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 mt-1 rounded-[12px] bg-white text-[#001f7a] font-semibold text-sm hover:bg-white/90 active:bg-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? "注册中…" : "立即注册"}
                </button>

                <p className="text-center text-xs text-white/55 pt-1">
                  注册即表示同意平台使用条款
                </p>
                <p className="text-center text-xs text-white/65">
                  已有账号？
                  <Link href="/login" className="text-white font-medium hover:underline ml-0.5">
                    去登录
                  </Link>
                </p>
              </form>
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
