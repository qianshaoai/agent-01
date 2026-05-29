"use client";
import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Plug, Plus, CheckCircle2, AlertCircle, Edit, Trash2,
  ToggleLeft, ToggleRight, Loader2, Activity, ShieldCheck, ShieldOff,
} from "lucide-react";
import {
  getPresetsByCategory,
  getPresetByCode,
  inferPresetFromExisting,
  type ProviderPreset,
} from "@/lib/model-providers/presets";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";

// 5.14up PR-A · 模型供应商管理后台
// 功能：列表、新增、编辑、启停、删除、测试连通性
// 权限：super_admin 全部操作；system_admin 仅看 + 测试
// 5.27up · 厂商预设：表单下拉走 lib/model-providers/presets.ts，
//   下拉选项里直接是各家厂商（OpenAI/智谱/千问/豆包/DeepSeek/Kimi/文心/混元 共 9 项），
//   选中后 endpoint / 默认模型 / 默认参数自动填好，admin 只需补 name + provider_code + api_key。
// 5.20up · "默认模型"字段加回：5.27up Fix 删除导致新建 provider 默认模型为空，
//   运行时兜底成 gpt-4o-mini，在非 OpenAI 兼容厂商（千问/豆包等）上会被服务端 404 拒绝。

type ApiCategory = "model" | "agent" | "embedding";

type Provider = {
  id: string;
  provider_code: string;
  name: string;
  platform: string;
  category: string;
  api_endpoint: string;
  default_model: string;
  default_params: Record<string, unknown>;
  enabled: boolean;
  has_api_key: boolean;
  // 5.30up · 组织归属（NULL = 平台公共；非 NULL = 某 org 建）
  tenant_code: string | null;
  created_at: string;
  updated_at: string;
};

// 5.30up · 当前管理员信息（用于前端 ownership 徽章 / 按钮灰显 / embedding 隐藏新增）
type MeInfo = { role: "super_admin" | "system_admin" | "org_admin"; tenantCode: string | null };

// 5.30up · 行归属类别（纯描述，不掺杂"我能不能改"）—— platform / own / other
type Ownership = "platform" | "own" | "other";
function ownershipOf(p: Provider, me: MeInfo | null): Ownership {
  if (p.tenant_code === null) return "platform";
  if (me?.role === "org_admin" && me.tenantCode && p.tenant_code === me.tenantCode) return "own";
  // super/system 视角下也用 "other" 表示"某 org 的非平台公共"（具体能不能改由 canWrite 判定）
  return "other";
}

/**
 * 5.30up R4 #3 · 写权限判定（与后端 API 写白名单口径同步）
 *   - super_admin → 全可写
 *   - system_admin → API 管理写全部禁（后端 requireWriteAccess 排了 system_admin）
 *   - org_admin → 仅 own（tenant_code === 自己 tenantCode）
 *
 * 不混淆 ownershipOf —— 那是"资源归属"的描述；这个是"我能改吗"的判断。
 */
function canWriteProvider(p: Provider, me: MeInfo | null): boolean {
  if (!me) return false;
  if (me.role === "super_admin") return true;
  if (me.role === "system_admin") return false; // API 写排 system_admin
  if (me.role === "org_admin") {
    return !!me.tenantCode && p.tenant_code === me.tenantCode;
  }
  return false;
}

/**
 * 5.30up R4 #3 · 测试权限（与后端 test 路由白名单同步：含 system_admin）
 *   - super/system → 可测任何
 *   - org_admin → 仅 own
 */
function canTestProvider(p: Provider, me: MeInfo | null): boolean {
  if (!me) return false;
  if (me.role === "super_admin" || me.role === "system_admin") return true;
  if (me.role === "org_admin") {
    return !!me.tenantCode && p.tenant_code === me.tenantCode;
  }
  return false;
}

const CATEGORY_LABEL: Record<ApiCategory, string> = {
  model: "大模型 API",
  agent: "智能体 API",
  embedding: "Embedding API",
};

/** 行 / 旧数据兜底归类（理论上 migration_v37 后都已有 category） */
function catOf(c: string | undefined): ApiCategory {
  if (c === "agent") return "agent";
  if (c === "embedding") return "embedding";
  return "model";
}

type FormState = {
  provider_code: string;
  name: string;
  /** 5.27up · 厂商预设 code（仅前端用，不入库）；选中后驱动 platform/endpoint/model 自动填 */
  preset_code: string;
  /** 入库字段：lib/adapters/index.ts 分发用的 platform 值 */
  platform: string;
  category: ApiCategory;
  api_endpoint: string;
  api_key: string;
  default_model: string;
  default_params_json: string;
  enabled: boolean;
  /**
   * 5.30up · 归属组织。提交时映射：
   *   - "" → null（平台公共）
   *   - "ORG-X" → "ORG-X"（赋给某 org）
   *   仅 super/system 在弹窗里能改；org_admin 强制本组织（后端会再 sanitize）
   */
  tenant_code: string;
};

// 按 category 造一份空表单：默认取该类首个 preset 的 endpoint / 模型 / 参数
function emptyFormFor(category: ApiCategory): FormState {
  const presets = getPresetsByCategory(category);
  const first = presets[0];
  // 该类至少有一个 preset，否则代码已失稳；fallback 仅防御
  if (!first) {
    return {
      provider_code: "", name: "", preset_code: "", platform: "openai", category,
      api_endpoint: "", api_key: "", default_model: "",
      default_params_json: "{}", enabled: true, tenant_code: "",
    };
  }
  return formFromPreset(first, { provider_code: "", name: "", api_key: "", enabled: true });
}

// 把一个 preset 应用到（部分）已有表单字段上 —— 共享给「初始化」+「切换预设」两条路径
// 5.20up · default_model 重新加回表单（5.27up Fix 删除导致新建空字符串、运行时兜底成
//   gpt-4o-mini → 在非 OpenAI 兼容厂商上 404）。新建时按预设默认模型预填，admin 可改。
function formFromPreset(
  preset: ProviderPreset,
  base: { provider_code: string; name: string; api_key: string; enabled: boolean },
): FormState {
  return {
    ...base,
    preset_code: preset.code,
    platform: preset.platform,
    category: preset.category,
    api_endpoint: preset.endpoint,
    default_model: preset.defaultModel,
    default_params_json: preset.defaultParams
      ? JSON.stringify(preset.defaultParams, null, 2)
      : "{}",
    tenant_code: "", // 默认平台公共（NULL）；super/system 可在表单里改
  };
}

type TestResult = { success: boolean; latency_ms: number; sample_text?: string; error?: string };

export default function ModelProvidersPage() {
  const [list, setList] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // 5.15up · 大模型 API / 智能体 API 两 tab
  const [activeTab, setActiveTab] = useState<ApiCategory>("model");

  // 5.30up · 当前管理员 + 组织列表（弹窗"归属组织"下拉）
  const [me, setMe] = useState<MeInfo | null>(null);
  const [tenants, setTenants] = useState<{ code: string; name: string }[]>([]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyFormFor("model"));
  // 5.27up Fix · 防重复提交（详见 lib/hooks/use-submit-guard.ts）
  const saveGuard = useSubmitGuard();

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  function flash(type: "ok" | "err", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }

  const loadList = useCallback(async () => {
    setLoading(true);
    // 同样的 3 次重试逻辑（Supabase 间歇 ECONNRESET）
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch("/api/admin/model-providers", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "加载失败");
        setList(data.data ?? []);
        setMsg(null);
        setLoading(false);
        return;
      } catch (e: unknown) {
        lastErr = e;
        if (i < 2) await new Promise((r) => setTimeout(r, 300));
      }
    }
    flash("err", lastErr instanceof Error ? lastErr.message : "加载失败");
    setLoading(false);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // 5.30up · 拉当前 admin 角色（弹窗 UI + 列表按钮灰显都依赖）
  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.role) setMe({ role: j.role, tenantCode: j.tenantCode ?? null }); })
      .catch(() => { /* 后端会再 sanitize；前端 me 缺失只影响 UX 不影响安全 */ });
  }, []);

  // 5.30up · super/system 才需要"归属组织"下拉；org_admin 强制本组织所以不拉
  useEffect(() => {
    if (!me || me.role === "org_admin") return;
    fetch("/api/admin/tenants?page=1&pageSize=100", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const arr = Array.isArray(j) ? j : (j?.data ?? []);
        setTenants((arr as { code: string; name: string }[]).filter((t) => t.code));
      })
      .catch(() => { /* 拉不到 → 弹窗只能选"平台公共"，不影响主流程 */ });
  }, [me]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyFormFor(activeTab));
    setEditorOpen(true);
  }

  function openEdit(p: Provider) {
    setEditingId(p.id);
    // 5.27up · 反查 preset：endpoint 精确匹配 → host 匹配 → 该 platform 首个 preset
    // 失败兜底（admin 编辑老数据时下拉里能有合适默认值）
    const cat = catOf(p.category);
    const inferred = inferPresetFromExisting(p.platform, p.api_endpoint, cat);
    setForm({
      provider_code: p.provider_code,
      name: p.name,
      preset_code: inferred.code,
      platform: p.platform, // 编辑场景以 DB 实际值为准，不被 preset 覆盖
      category: cat,
      api_endpoint: p.api_endpoint,
      api_key: "", // 留空 = 不修改
      // 5.20up · DB default_model 为空（5.27up Fix 期间新建的 provider 入库为 ""）时，
      //   用反查到的厂商预设默认模型补上 —— 否则保存还是空、运行时兜底 gpt-4o-mini，
      //   非 OpenAI 兼容厂商会 404。已有 DB 值则不动。
      default_model: p.default_model || inferred.defaultModel,
      default_params_json: JSON.stringify(p.default_params ?? {}, null, 2),
      enabled: p.enabled,
      // 5.30up · 读出当前归属（NULL → ""）
      tenant_code: p.tenant_code ?? "",
    });
    setEditorOpen(true);
  }

  async function save() {
    // JSON 格式预校验放在 guard 外面，校验失败不消耗 guard 名额 / 幂等键
    let defaultParams: Record<string, unknown> = {};
    try {
      defaultParams = form.default_params_json.trim()
        ? JSON.parse(form.default_params_json)
        : {};
      if (typeof defaultParams !== "object" || Array.isArray(defaultParams)) {
        throw new Error("默认参数必须是 JSON 对象");
      }
    } catch {
      flash("err", "默认参数 JSON 格式错误");
      return;
    }

    await saveGuard.submit(async (idempotencyKey) => {
      try {
        const payload: Record<string, unknown> = {
          name: form.name,
          platform: form.platform,
          category: form.category,
          api_endpoint: form.api_endpoint,
          default_model: form.default_model,
          default_params: defaultParams,
          enabled: form.enabled,
        };
        // api_key 仅在非空时提交（编辑场景留空 = 不改）
        if (form.api_key) payload.api_key = form.api_key;
        // 5.30up · super/system 才能在前端改 tenant_code；org_admin 后端会 sanitize 剥离
        //   "" → null（平台公共）；非空 → 字符串
        if (me?.role === "super_admin" || me?.role === "system_admin") {
          payload.tenant_code = form.tenant_code === "" ? null : form.tenant_code;
        }

        let res: Response;
        if (editingId) {
          // PATCH 天然幂等（RFC 7231），不带 Idempotency-Key
          res = await fetch(`/api/admin/model-providers/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          // 创建时 provider_code 必填
          payload.provider_code = form.provider_code;
          res = await fetch("/api/admin/model-providers", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(payload),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "保存失败");
        flash("ok", editingId ? "已更新" : "已创建");
        setEditorOpen(false);
        await loadList();
      } catch (e: unknown) {
        flash("err", e instanceof Error ? e.message : "保存失败");
      }
    });
  }

  async function toggleEnabled(p: Provider) {
    try {
      const res = await fetch(`/api/admin/model-providers/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "切换失败");
      }
      flash("ok", p.enabled ? "已禁用" : "已启用");
      await loadList();
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "切换失败");
    }
  }

  async function clearKey(p: Provider) {
    if (!confirm(`确认清空 ${p.name} 的 API Key？清空后该供应商不可被智能体使用，直到重新配置。`)) return;
    try {
      const res = await fetch(`/api/admin/model-providers/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear_api_key: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "清空失败");
      }
      flash("ok", "已清空 API Key");
      await loadList();
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "清空失败");
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`确认删除供应商 ${p.name}？\n\n如果该供应商被任何智能体或草稿引用，删除会被阻止，建议改用"禁用"。`)) return;
    try {
      const res = await fetch(`/api/admin/model-providers/${p.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      flash("ok", "已删除");
      await loadList();
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "删除失败");
    }
  }

  async function testConnect(p: Provider) {
    setTestingId(p.id);
    try {
      const res = await fetch(`/api/admin/model-providers/${p.id}/test`, { method: "POST" });
      const data: TestResult = await res.json();
      setTestResults((prev) => ({ ...prev, [p.id]: data }));
      if (data.success) {
        flash("ok", `${p.name} 连接成功（${data.latency_ms}ms）`);
      } else {
        flash("err", `${p.name} 连接失败：${data.error ?? "未知"}`);
      }
    } catch (e: unknown) {
      flash("err", e instanceof Error ? e.message : "测试失败");
    } finally {
      setTestingId(null);
    }
  }

  // 当前 tab 下可见的列表
  const visible = list.filter((p) => catOf(p.category) === activeTab);

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <PageHeader
          icon={<Plug size={20} />}
          title="API 管理"
          subtitle="集中管理大模型 / 智能体平台的接入地址、API Key、默认参数"
          actions={
            // 5.30up · embedding tab 对 org_admin 隐藏新增按钮（基建仅平台可建）
            !(activeTab === "embedding" && me?.role === "org_admin") && (
              <Button onClick={openCreate} className="flex items-center gap-1.5">
                <Plus size={16} /> 新增{CATEGORY_LABEL[activeTab]}
              </Button>
            )
          }
        />

        {/* 5.15up · 大模型 API / 智能体 API 两 tab */}
        <div className="flex gap-1 border-b border-gray-200">
          {(["model", "agent", "embedding"] as ApiCategory[]).map((c) => {
            const count = list.filter((p) => catOf(p.category) === c).length;
            return (
              <button
                key={c}
                onClick={() => setActiveTab(c)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === c
                    ? "border-[#002FA7] text-[#002FA7]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {CATEGORY_LABEL[c]}
                <span className="ml-1.5 text-xs text-gray-400">{count}</span>
              </button>
            );
          })}
        </div>

        {msg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-[10px] text-sm ${msg.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
            {msg.type === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={20} /> 加载中…
          </div>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            还没有任何{CATEGORY_LABEL[activeTab]}，点右上角「新增{CATEGORY_LABEL[activeTab]}」开始配置
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">名称 / 编号</th>
                  <th className="px-4 py-3 text-left font-medium">厂商</th>
                  <th className="px-4 py-3 text-left font-medium">归属</th>
                  <th className="px-4 py-3 text-left font-medium">API Key</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((p) => {
                  const tr = testResults[p.id];
                  // 5.30up · 归属徽章用 ownershipOf，按钮可写 / 可测分开判定（R4 #3）
                  const ownership = ownershipOf(p, me);
                  const canWrite = canWriteProvider(p, me);
                  const canTest = canTestProvider(p, me);
                  return (
                    <tr key={p.id} className={p.enabled ? "" : "opacity-50"}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.provider_code}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {/* 5.27up · 按 endpoint 反查厂商预设，显示真实厂商名（DeepSeek/Kimi/通义...）
                            而不是统一显示 "OpenAI"（多家厂商共享 platform="openai"）*/}
                        {inferPresetFromExisting(p.platform, p.api_endpoint, catOf(p.category)).label.split("（")[0]}
                      </td>
                      {/* 5.30up · 归属徽章列 */}
                      <td className="px-4 py-3">
                        {ownership === "platform" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700">
                            平台公共
                          </span>
                        ) : ownership === "own" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-green-50 text-green-700">
                            {me?.role === "org_admin" ? "本组织" : (p.tenant_code ?? "—")}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500"
                            title={`归属组织：${p.tenant_code}`}
                          >
                            其他组织
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.has_api_key ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                            <ShieldCheck size={13} /> 已配置
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                            <ShieldOff size={13} /> 未配置
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.enabled ? (
                          <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                            <ToggleRight size={14} /> 启用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                            <ToggleLeft size={14} /> 禁用
                          </span>
                        )}
                        {tr && (
                          <div className={`text-[11px] mt-1 ${tr.success ? "text-green-600" : "text-red-500"}`}>
                            {tr.success ? `✓ ${tr.latency_ms}ms` : `✗ ${tr.error?.slice(0, 30)}…`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* 「测试」是发一条真实对话验证连通，只对大模型 API 有意义；
                              智能体 API（Coze 等）需 bot_id 才能对话，bot_id 在智能体上、
                              不在凭证里，无法在此层测试 —— 故仅大模型 API 显示「测试」
                              5.30up R4 #3 · 测试白名单后端含 system_admin，但 org_admin 仅可测 own；
                              用 canTest 单独判（区别于其它写按钮的 canWrite） */}
                          {activeTab === "model" && (
                            <button
                              onClick={() => testConnect(p)}
                              disabled={!p.enabled || !p.has_api_key || testingId === p.id || !canTest}
                              className="text-xs text-[#002FA7] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1"
                              title={
                                canTest ? "测试连通性"
                                : ownership === "other" ? "非本组织资源，无权测试"
                                : "无权测试"
                              }
                            >
                              {testingId === p.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Activity size={12} />}
                              测试
                            </button>
                          )}
                          {/* 编辑 / 启停 / 清空Key / 删除 都按 canWrite 判（API 写白名单后端排 system_admin） */}
                          <button
                            onClick={() => openEdit(p)}
                            disabled={!canWrite}
                            className="text-xs text-gray-600 hover:text-[#002FA7] disabled:text-gray-300 disabled:cursor-not-allowed inline-flex items-center gap-1"
                            title={
                              canWrite ? ""
                              : me?.role === "system_admin" ? "系统管理员仅可查看 / 测试，不可编辑 API 配置"
                              : ownership === "platform" ? "平台公共资源，仅超级管理员可改"
                              : "非本组织资源，仅可见不可编辑"
                            }
                          >
                            <Edit size={12} /> 编辑
                          </button>
                          <button
                            onClick={() => toggleEnabled(p)}
                            disabled={!canWrite}
                            className="text-xs text-gray-600 hover:text-amber-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                            title={
                              canWrite ? ""
                              : me?.role === "system_admin" ? "系统管理员无权启停"
                              : ownership === "platform" ? "平台公共资源，仅超级管理员可改"
                              : "非本组织资源，无权操作"
                            }
                          >
                            {p.enabled ? "禁用" : "启用"}
                          </button>
                          {p.has_api_key && (
                            <button
                              onClick={() => clearKey(p)}
                              disabled={!canWrite}
                              className="text-xs text-gray-500 hover:text-orange-600 disabled:text-gray-300 disabled:cursor-not-allowed"
                              title={canWrite ? "清空 API Key" : "无权操作"}
                            >
                              清空Key
                            </button>
                          )}
                          <button
                            onClick={() => remove(p)}
                            disabled={!canWrite}
                            className="text-xs text-gray-500 hover:text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed inline-flex items-center gap-1"
                            title={
                              canWrite ? ""
                              : me?.role === "system_admin" ? "系统管理员无权删除"
                              : ownership === "platform" ? "平台公共资源，仅超级管理员可删"
                              : "非本组织资源，无权删除"
                            }
                          >
                            <Trash2 size={12} /> 删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 编辑器弹窗 */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditorOpen(false)}
        >
          <div
            className="bg-white rounded-[14px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">
                {(editingId ? "编辑" : "新增") + CATEGORY_LABEL[form.category]}
              </h3>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500">供应商编号 *</label>
                  <input
                    type="text"
                    value={form.provider_code}
                    onChange={(e) => {
                      // 实时过滤：只保留英文字母 / 数字 / 下划线 / 短横线（中文等非法字符直接吃掉）
                      const cleaned = e.target.value.replace(/[^a-zA-Z0-9_-]/g, "");
                      setForm({ ...form, provider_code: cleaned });
                    }}
                    placeholder="如：openai-main"
                    disabled={!!editingId}
                    className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                  <p className="text-[11px] text-gray-400">英文字母 / 数字 / _ / -，创建后不可改</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500">名称 *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="如：OpenAI 主账号"
                    className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">厂商 *</label>
                <select
                  value={form.preset_code}
                  onChange={(e) => {
                    const newPreset = getPresetByCode(e.target.value);
                    if (!newPreset) return;
                    const oldPreset = getPresetByCode(form.preset_code);
                    // 切换厂商时，endpoint / 默认模型 / 默认参数：
                    //   - 字段为空 OR 还是旧预设的原值 → 覆盖为新预设的默认值
                    //   - admin 已手填过 → 保留不动
                    // 5.20up · default_model 走与 endpoint 同一套联动逻辑
                    const keepEndpoint =
                      form.api_endpoint && form.api_endpoint !== (oldPreset?.endpoint ?? "");
                    const keepModel =
                      form.default_model && form.default_model !== (oldPreset?.defaultModel ?? "");
                    const oldParamsJson = oldPreset?.defaultParams
                      ? JSON.stringify(oldPreset.defaultParams, null, 2)
                      : "{}";
                    const keepParams =
                      form.default_params_json.trim() &&
                      form.default_params_json !== oldParamsJson &&
                      form.default_params_json !== "{}";
                    setForm({
                      ...form,
                      preset_code: newPreset.code,
                      platform: newPreset.platform,
                      api_endpoint: keepEndpoint ? form.api_endpoint : newPreset.endpoint,
                      default_model: keepModel ? form.default_model : newPreset.defaultModel,
                      default_params_json: keepParams
                        ? form.default_params_json
                        : newPreset.defaultParams
                          ? JSON.stringify(newPreset.defaultParams, null, 2)
                          : "{}",
                    });
                  }}
                  className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                >
                  {getPresetsByCategory(form.category).map((p) => (
                    <option key={p.code} value={p.code}>{p.label}</option>
                  ))}
                </select>
                {/* 选中厂商的小提示（来源 / 注意事项） */}
                {(() => {
                  const cur = getPresetByCode(form.preset_code);
                  return cur?.hint ? (
                    <p className="text-[11px] text-gray-500 leading-snug">💡 {cur.hint}</p>
                  ) : null;
                })()}
              </div>

              {/* 5.30up · 归属组织下拉：仅 super/system 可见。
                  - 平台公共（""）/ 各 tenant
                  - embedding category 强制平台公共（与后端 R2 §3 同口径），下拉禁选其他
                  - org_admin 隐藏整段，后端强制本组织 */}
              {(me?.role === "super_admin" || me?.role === "system_admin") && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500">
                    归属组织 {form.category === "embedding" && <span className="text-gray-400">（Embedding 必须平台公共）</span>}
                  </label>
                  <select
                    value={form.tenant_code}
                    onChange={(e) => setForm({ ...form, tenant_code: e.target.value })}
                    disabled={form.category === "embedding"}
                    className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="">平台公共（全员可见 / 仅 super 可改）</option>
                    {tenants.map((t) => (
                      <option key={t.code} value={t.code}>{t.name}（{t.code}）</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-400">
                    赋给某组织后，该组织管理员可见可改；编辑时改归属属于「转让」，后端会检查是否被引用。
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">接口地址 *</label>
                <input
                  type="text"
                  value={form.api_endpoint}
                  onChange={(e) => setForm({ ...form, api_endpoint: e.target.value })}
                  placeholder="https://api.openai.com/v1/chat/completions"
                  className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500">
                  API Key {editingId ? "（留空 = 不修改）" : "*"}
                </label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={editingId ? "留空保持原 Key" : "sk-… 或 fe_oa_…"}
                  className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono"
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-gray-400">加密存储；保存后不可再次查看明文</p>
              </div>

              {/* 5.20up · 默认模型字段加回（5.27up Fix 删除导致新建为空、运行时兜底
                  成 gpt-4o-mini → 在非 OpenAI 兼容厂商上 404）。切厂商时按预设联动填，
                  admin 仍可手填覆盖；agent 侧的模型设置可继续覆盖此默认值。
                  「智能体 API」（Coze/Dify/元器/清言）模型与参数都在平台侧 bot 上配，
                  这两个字段都不显示。*/}
              {(form.category === "model" || form.category === "embedding") && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-500">默认模型</label>
                    <input
                      type="text"
                      value={form.default_model}
                      onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                      placeholder={
                        getPresetByCode(form.preset_code)?.defaultModel || "如：qwen-plus / deepseek-chat / gpt-4o-mini"
                      }
                      className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono text-xs"
                    />
                    <p className="text-[11px] text-gray-400">
                      切换厂商时会按预设自动填；不填则运行时兜底（openai 平台兜底
                      <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded text-[10px]">gpt-4o-mini</code>
                      非 openai 平台会被服务端拒绝）。agent 侧未单独指定模型时使用此值。
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-500">默认参数（JSON）</label>
                    <textarea
                      value={form.default_params_json}
                      onChange={(e) => setForm({ ...form, default_params_json: e.target.value })}
                      rows={4}
                      placeholder='{"temperature": 0.7, "max_tokens": 2000}'
                      className="px-3 py-2 border border-gray-200 rounded-[8px] text-xs focus:outline-none focus:border-[#002FA7] font-mono"
                    />
                  </div>
                </>
              )}

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                启用（关闭则该供应商不可被新智能体选择）
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setEditorOpen(false)}
                className="px-4 h-9 rounded-[8px] text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <Button onClick={save} loading={saveGuard.loading}>
                {editingId ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
