"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, User, Lock, Building2, Zap, Calendar, CheckCircle2 } from "lucide-react";

type UserInfo = {
  phone: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
  quota: { total: number; used: number; left: number; expiresAt: string } | null;
};

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [form, setForm] = useState({ oldPwd: "", newPwd: "", confirmPwd: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/me").then(async (r) => {
      if (r.ok) setUser(await r.json());
    });
  }, []);

  async function handleChangePwd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (!form.oldPwd || !form.newPwd || !form.confirmPwd) {
      setError("请填写所有密码字段");
      return;
    }
    if (form.newPwd !== form.confirmPwd) {
      setError("两次新密码不一致");
      return;
    }
    if (form.newPwd.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: form.oldPwd, newPassword: form.newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "修改失败");
        return;
      }
      setSuccess(true);
      setForm({ oldPwd: "", newPwd: "", confirmPwd: "" });
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  const quota = user?.quota;
  const quotaPct = quota ? Math.round((quota.used / quota.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#f8f9fc]">
      <header className="bg-white border-b border-gray-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-[8px] hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h1 className="font-semibold text-gray-900">账号设置</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-5 page-enter">
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <User size={15} className="text-[#002FA7]" /> 账号信息
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">手机号</p>
              <p className="font-medium text-gray-800">{user?.phone ?? "—"}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">当前空间</p>
              <div className="flex items-center gap-2">
                <Building2 size={14} className="text-[#002FA7]" />
                <p className="font-medium text-gray-800">{user?.isPersonal ? "个人空间" : user?.tenantName ?? "—"}</p>
              </div>
            </div>
            {!user?.isPersonal && (
              <div className="p-4 bg-gray-50 rounded-[12px]">
                <p className="text-xs text-gray-400 mb-1">企业码</p>
                <p className="font-medium text-gray-800 font-mono">{user?.tenantCode}</p>
              </div>
            )}
          </div>
        </div>

        {quota && (
          <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
              <Zap size={15} className="text-amber-500" /> 使用配额
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="text-center p-4 bg-[#f0f4ff] rounded-[12px]">
                <p className="text-2xl font-bold text-[#002FA7]">{quota.left}</p>
                <p className="text-xs text-gray-500 mt-1">剩余次数</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-[12px]">
                <p className="text-2xl font-bold text-gray-700">{quota.used}</p>
                <p className="text-xs text-gray-500 mt-1">已使用次数</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-[12px]">
                <p className="text-2xl font-bold text-gray-700">{quota.total}</p>
                <p className="text-xs text-gray-500 mt-1">总次数</p>
              </div>
            </div>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                <span>已使用 {quotaPct}%</span>
                <span>剩余 {100 - quotaPct}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${quotaPct >= 90 ? "bg-red-500" : quotaPct >= 70 ? "bg-amber-500" : "bg-[#002FA7]"}`}
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar size={14} className="text-gray-400" />
              <span>到期时间：<strong>{quota.expiresAt}</strong></span>
            </div>
          </div>
        )}

        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <Lock size={15} className="text-[#002FA7]" /> 修改密码
          </h2>
          {success && (
            <div className="mb-4 p-4 bg-green-50 rounded-[12px] flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 size={16} /> 密码修改成功，下次登录请使用新密码
            </div>
          )}
          <form onSubmit={handleChangePwd} className="space-y-4">
            <Input label="当前密码" type="password" placeholder="请输入当前密码" value={form.oldPwd} onChange={(e) => setForm({ ...form, oldPwd: e.target.value })} />
            <Input label="新密码" type="password" placeholder="请输入新密码（至少 6 位）" value={form.newPwd} onChange={(e) => setForm({ ...form, newPwd: e.target.value })} />
            <Input label="确认新密码" type="password" placeholder="再次输入新密码" value={form.confirmPwd} onChange={(e) => setForm({ ...form, confirmPwd: e.target.value })} />
            {error && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{error}</div>}
            <Button type="submit" loading={loading}>确认修改</Button>
          </form>
        </div>
      </main>
    </div>
  );
}
