"use client";
import { useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { ShieldCheck } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function FirstLoginModal({ onClose }: Props) {
  const [form, setForm] = useState({ oldPwd: "", newPwd: "", confirmPwd: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.oldPwd || !form.newPwd || !form.confirmPwd) { setError("请填写所有字段"); return; }
    if (form.newPwd !== form.confirmPwd) { setError("两次密码不一致"); return; }
    if (form.newPwd.length < 6) { setError("新密码至少 6 位"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldPassword: form.oldPwd, newPassword: form.newPwd }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "修改失败"); return; }
      setDone(true);
      setTimeout(onClose, 1800);
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-[20px] shadow-2xl w-full max-w-sm p-8">
        {done ? (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <ShieldCheck size={28} className="text-green-600" />
            </div>
            <p className="font-semibold text-gray-900">密码修改成功！</p>
            <p className="text-sm text-gray-500">即将关闭…</p>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-[14px] bg-[#002FA7]/10 flex items-center justify-center mx-auto mb-3">
                <ShieldCheck size={24} className="text-[#002FA7]" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">请修改初始密码</h2>
              <p className="text-sm text-gray-500 mt-1">为保障账号安全，首次登录请修改默认密码</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input label="当前密码（初始密码）" type="password" placeholder="输入初始密码" value={form.oldPwd} onChange={(e) => setForm({ ...form, oldPwd: e.target.value })} />
              <Input label="新密码" type="password" placeholder="至少 6 位" value={form.newPwd} onChange={(e) => setForm({ ...form, newPwd: e.target.value })} />
              <Input label="确认新密码" type="password" placeholder="再次输入新密码" value={form.confirmPwd} onChange={(e) => setForm({ ...form, confirmPwd: e.target.value })} />
              {error && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{error}</div>}
              <Button type="submit" size="lg" className="w-full" loading={loading}>确认修改</Button>
            </form>
            <button onClick={onClose} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-3">稍后修改</button>
          </>
        )}
      </div>
    </div>
  );
}
