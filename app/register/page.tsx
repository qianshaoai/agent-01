"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Phone, Lock, Building2, User, UserCheck } from "lucide-react";

type UserType = "personal" | "organization";

const inputCls =
  "w-full h-11 bg-white border border-gray-200 rounded-[12px] pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all";

function FieldIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#f0f4ff] via-white to-[#f8f9ff]">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-[10px] overflow-hidden shrink-0 flex items-center justify-center bg-[#002FA7]">
            {siteSettings.logo_url ? (
              <img src={siteSettings.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <span className="text-white text-xs font-bold">AI</span>
            )}
          </div>
          <span className="font-semibold text-gray-900 text-sm">
            前哨科技 · {siteSettings.platform_name || "AI 智能体平台"}
          </span>
        </div>
        <Link href="/login" className="text-sm text-[#002FA7] hover:underline">
          已有账号，去登录
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(0,47,167,0.08)] p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 mb-1">创建账号</h1>
              <p className="text-sm text-gray-500">填写信息完成注册，注册后自动登录</p>
            </div>

            {/* 用户类型切换 */}
            <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-[12px]">
              <button
                type="button"
                onClick={() => { setUserType("personal"); setError(""); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-sm font-medium transition-all ${
                  userType === "personal"
                    ? "bg-white shadow-sm text-[#002FA7]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <User size={14} /> 个人用户
              </button>
              <button
                type="button"
                onClick={() => { setUserType("organization"); setError(""); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-sm font-medium transition-all ${
                  userType === "organization"
                    ? "bg-white shadow-sm text-[#002FA7]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Building2 size={14} /> 组织用户
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 用户名 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">用户名</label>
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
                <label className="text-sm font-medium text-gray-700">真实姓名</label>
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
                <label className="text-sm font-medium text-gray-700">手机号</label>
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
                  <label className="text-sm font-medium text-gray-700">组织码</label>
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
                  <p className="text-xs text-gray-400">组织码由管理员提供，4~8 位英文字母</p>
                </div>
              )}

              {/* 密码 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">密码</label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPwd(!showPwd)}
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* 确认密码 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">确认密码</label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowConfirm(!showConfirm)}
                  >
                    {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
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
                {loading ? "注册中…" : "立即注册"}
              </button>

              <p className="text-center text-xs text-gray-400 pt-1">
                注册即表示同意平台使用条款
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
