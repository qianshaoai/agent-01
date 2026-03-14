"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, User, Lock, Building2, Zap, Calendar, CheckCircle2, Edit3, AlertTriangle } from "lucide-react";

type UserInfo = {
  userId: string;
  phone: string;
  nickname: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
  status: string;
  createdAt: string | null;
  quota: { total: number; used: number; left: number; expiresAt: string } | null;
};

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active:   { label: "正常",  cls: "bg-green-50 text-green-600" },
  disabled: { label: "已禁用", cls: "bg-amber-50 text-amber-600" },
  deleted:  { label: "已注销", cls: "bg-red-50 text-red-400" },
};

const inputCls = "w-full h-10 border border-gray-200 rounded-[10px] px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all";

export default function SettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null);

  // 修改用户名
  const [nicknameInput, setNicknameInput] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 修改密码
  const [pwdForm, setPwdForm] = useState({ oldPwd: "", newPwd: "", confirmPwd: "" });
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  // 注销账号
  const [showCancel, setShowCancel] = useState(false);
  const [cancelPwd, setCancelPwd] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    fetch("/api/me").then(async (r) => {
      if (r.ok) {
        const data = await r.json();
        setUser(data);
        setNicknameInput(data.nickname || "");
      }
    });
  }, []);

  async function saveNickname() {
    setNicknameMsg(null);
    const trimmed = nicknameInput.trim();
    if (!trimmed) { setNicknameMsg({ ok: false, text: "用户名不能为空" }); return; }
    if (trimmed.length < 2 || trimmed.length > 20) { setNicknameMsg({ ok: false, text: "用户名长度为 2~20 个字符" }); return; }
    setNicknameSaving(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setNicknameMsg({ ok: false, text: data.error ?? "保存失败" }); return; }
      setUser((prev) => prev ? { ...prev, nickname: trimmed } : prev);
      setNicknameMsg({ ok: true, text: "用户名已更新" });
    } finally {
      setNicknameSaving(false);
    }
  }

  async function handleChangePwd(e: React.FormEvent) {
    e.preventDefault();
    setPwdError("");
    if (!pwdForm.oldPwd || !pwdForm.newPwd || !pwdForm.confirmPwd) { setPwdError("请填写所有密码字段"); return; }
    if (pwdForm.newPwd !== pwdForm.confirmPwd) { setPwdError("两次新密码不一致"); return; }
    if (pwdForm.newPwd.length < 8) { setPwdError("新密码至少 8 位"); return; }
    setPwdLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: pwdForm.oldPwd, newPassword: pwdForm.newPwd }),
      });
      const data = await res.json();
      if (!res.ok) { setPwdError(data.error ?? "修改失败"); return; }
      setPwdSuccess(true);
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    } finally {
      setPwdLoading(false);
    }
  }

  async function handleCancelAccount() {
    setCancelError("");
    if (!cancelPwd) { setCancelError("请输入当前密码"); return; }
    setCancelLoading(true);
    try {
      const res = await fetch("/api/auth/cancel-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: cancelPwd }),
      });
      const data = await res.json();
      if (!res.ok) { setCancelError(data.error ?? "注销失败"); return; }
      window.location.href = "/login";
    } finally {
      setCancelLoading(false);
    }
  }

  const quota = user?.quota;
  const quotaPct = quota ? Math.round((quota.used / quota.total) * 100) : 0;
  const statusInfo = STATUS_MAP[user?.status ?? "active"] ?? STATUS_MAP.active;
  const displayName = user?.nickname || user?.phone || "—";

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

        {/* ── 账号信息 ─────────────────────────────────── */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <User size={15} className="text-[#002FA7]" /> 账号信息
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">显示名称</p>
              <p className="font-medium text-gray-800">{displayName}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">手机号</p>
              <p className="font-medium text-gray-800">{user?.phone ?? "—"}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">用户类型</p>
              <div className="flex items-center gap-2">
                <Building2 size={14} className="text-[#002FA7]" />
                <p className="font-medium text-gray-800">{user ? (user.isPersonal ? "个人用户" : "企业用户") : "—"}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-[12px]">
              <p className="text-xs text-gray-400 mb-1">账号状态</p>
              {user && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.cls}`}>
                  {statusInfo.label}
                </span>
              )}
            </div>
            {!user?.isPersonal && (
              <div className="p-4 bg-gray-50 rounded-[12px]">
                <p className="text-xs text-gray-400 mb-1">企业码</p>
                <p className="font-medium text-gray-800 font-mono">{user?.tenantCode}</p>
              </div>
            )}
            {user?.createdAt && (
              <div className="p-4 bg-gray-50 rounded-[12px]">
                <p className="text-xs text-gray-400 mb-1">注册时间</p>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-gray-400" />
                  <p className="font-medium text-gray-800">
                    {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 修改用户名 ────────────────────────────────── */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <Edit3 size={15} className="text-[#002FA7]" /> 修改用户名
          </h2>
          <div className="flex gap-2">
            <input
              className="flex-1 h-10 border border-gray-200 rounded-[10px] px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all"
              placeholder="2~20 个字符"
              value={nicknameInput}
              maxLength={20}
              onChange={(e) => { setNicknameInput(e.target.value); setNicknameMsg(null); }}
            />
            <button
              onClick={saveNickname}
              disabled={nicknameSaving}
              className="px-4 h-10 rounded-[10px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] transition-colors disabled:opacity-60 shrink-0"
            >
              {nicknameSaving ? "保存中…" : "保存"}
            </button>
          </div>
          {nicknameMsg && (
            <p className={`mt-2 text-xs ${nicknameMsg.ok ? "text-green-600" : "text-red-500"}`}>
              {nicknameMsg.text}
            </p>
          )}
        </div>

        {/* ── 使用配额 ─────────────────────────────────── */}
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

        {/* ── 修改密码 ─────────────────────────────────── */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
            <Lock size={15} className="text-[#002FA7]" /> 修改密码
          </h2>
          {pwdSuccess ? (
            <div className="p-4 bg-green-50 rounded-[12px] flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 size={16} /> 密码修改成功，即将跳转到登录页…
            </div>
          ) : (
            <form onSubmit={handleChangePwd} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">当前密码</label>
                <input type="password" className={inputCls} placeholder="请输入当前密码"
                  value={pwdForm.oldPwd} onChange={(e) => setPwdForm({ ...pwdForm, oldPwd: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">新密码</label>
                <input type="password" className={inputCls} placeholder="至少 8 位，支持字母、数字及特殊字符"
                  value={pwdForm.newPwd} onChange={(e) => setPwdForm({ ...pwdForm, newPwd: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600">确认新密码</label>
                <input type="password" className={inputCls} placeholder="再次输入新密码"
                  value={pwdForm.confirmPwd} onChange={(e) => setPwdForm({ ...pwdForm, confirmPwd: e.target.value })} />
              </div>
              {pwdError && <div className="p-3 bg-red-50 rounded-[10px] text-sm text-red-500">{pwdError}</div>}
              <button type="submit" disabled={pwdLoading}
                className="w-full h-10 rounded-[10px] bg-[#002FA7] text-white text-sm font-medium hover:bg-[#001f7a] transition-colors disabled:opacity-60">
                {pwdLoading ? "提交中…" : "确认修改"}
              </button>
            </form>
          )}
        </div>

        {/* ── 注销账号 ─────────────────────────────────── */}
        <div className="bg-white rounded-[16px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 border border-red-50">
          <h2 className="text-sm font-semibold text-red-500 mb-2 flex items-center gap-2">
            <AlertTriangle size={15} /> 注销账号
          </h2>
          <p className="text-xs text-gray-400 mb-4 leading-relaxed">
            注销后账号将无法登录，数据不可恢复。请谨慎操作。
          </p>
          {!showCancel ? (
            <button
              onClick={() => setShowCancel(true)}
              className="px-4 py-2 rounded-[10px] text-sm text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
            >
              我要注销账号
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-red-500 font-medium">请输入当前密码确认注销：</p>
              <input
                type="password"
                className="w-full h-10 border border-red-200 rounded-[10px] px-3 text-sm focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                placeholder="当前密码"
                value={cancelPwd}
                onChange={(e) => { setCancelPwd(e.target.value); setCancelError(""); }}
              />
              {cancelError && <p className="text-xs text-red-500">{cancelError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowCancel(false); setCancelPwd(""); setCancelError(""); }}
                  className="flex-1 h-9 rounded-[10px] text-sm text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCancelAccount}
                  disabled={cancelLoading}
                  className="flex-1 h-9 rounded-[10px] text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60"
                >
                  {cancelLoading ? "注销中…" : "确认注销"}
                </button>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
