"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, User, Lock } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      router.push("/admin/dashboard");
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fc]">
      <div className="w-full max-w-sm page-enter">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-[12px] bg-[#002FA7] flex items-center justify-center">
              <span className="text-white text-sm font-bold">AI</span>
            </div>
          </div>
          <h1 className="text-xl font-bold text-gray-900">管理后台</h1>
          <p className="text-sm text-gray-400 mt-1">前哨科技 · AI 智能体平台</p>
        </div>

        <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(0,47,167,0.08)] p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="管理员账号" placeholder="请输入用户名" icon={<User size={16} />} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">密码</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type={show ? "text" : "password"} placeholder="请输入密码" className="w-full h-11 bg-white border border-gray-200 rounded-[12px] pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setShow(!show)}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{error}</div>}
            <Button type="submit" size="lg" className="w-full" loading={loading}>登录管理后台</Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">© 2024 前哨科技（QianShao.AI）</p>
      </div>
    </div>
  );
}
