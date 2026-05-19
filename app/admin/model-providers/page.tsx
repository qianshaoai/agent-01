"use client";
import { useState, useEffect, useCallback } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Plug, Plus, CheckCircle2, AlertCircle, Edit, Trash2,
  ToggleLeft, ToggleRight, Loader2, Activity, ShieldCheck, ShieldOff,
} from "lucide-react";

// 5.14up PR-A · 模型供应商管理后台
// 功能：列表、新增、编辑、启停、删除、测试连通性
// 权限：super_admin 全部操作；system_admin 仅看 + 测试

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
  created_at: string;
  updated_at: string;
};

// 5.15up API 管理模块 · 平台按 category 分两类
const PLATFORM_OPTIONS: { value: string; label: string; category: ApiCategory }[] = [
  { value: "openai", label: "OpenAI（兼容协议 / GPT 系列 / 第三方中转）", category: "model" },
  { value: "zhipu", label: "智谱 GLM", category: "model" },
  { value: "coze", label: "扣子 Coze", category: "agent" },
  { value: "dify", label: "Dify", category: "agent" },
  { value: "yuanqi", label: "腾讯元器", category: "agent" },
  { value: "qingyan", label: "智谱清言", category: "agent" },
  // 5.19up D1-2 · 知识库 embedding 配置（lib/kb/embed.ts 从这里取配置）
  { value: "zhipu", label: "智谱 Embedding（embedding-2 / embedding-3）", category: "embedding" },
];

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

// 平台 → 展示名；同一 platform 值可能在多个 category 下出现（如 zhipu），取首个
const PLATFORM_LABEL: Record<string, string> = {};
for (const p of PLATFORM_OPTIONS) {
  if (!(p.value in PLATFORM_LABEL)) PLATFORM_LABEL[p.value] = p.label;
}

// 各平台的默认 endpoint / model（切换平台时自动填）
const PLATFORM_DEFAULTS: Record<string, { endpoint: string; model: string }> = {
  openai:  { endpoint: "https://api.openai.com/v1/chat/completions",                 model: "gpt-4o-mini" },
  zhipu:   { endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",       model: "glm-4-flash" },
  coze:    { endpoint: "https://api.coze.cn/v3/chat",                                 model: "" },
  dify:    { endpoint: "",                                                            model: "" },
  yuanqi:  { endpoint: "https://yuanqi.tencent.com/openapi/v1/agent/chat/completions", model: "" },
  qingyan: { endpoint: "",                                                            model: "" },
};

type FormState = {
  provider_code: string;
  name: string;
  platform: string;
  category: ApiCategory;
  api_endpoint: string;
  api_key: string;
  default_model: string;
  default_params_json: string;
  enabled: boolean;
};

// 按 category 造一份空表单：平台 / endpoint / model 取该类首个平台的默认值
function emptyFormFor(category: ApiCategory): FormState {
  if (category === "embedding") {
    // D1：智谱 embedding，向量维度固定 1024（embedding-3 用 dimensions 参数降维）
    return {
      provider_code: "",
      name: "",
      platform: "zhipu",
      category: "embedding",
      api_endpoint: "https://open.bigmodel.cn/api/paas/v4/embeddings",
      api_key: "",
      default_model: "embedding-3",
      default_params_json: '{\n  "dimensions": 1024\n}',
      enabled: true,
    };
  }
  const platform = category === "model" ? "openai" : "coze";
  const d = PLATFORM_DEFAULTS[platform];
  return {
    provider_code: "",
    name: "",
    platform,
    category,
    api_endpoint: d?.endpoint ?? "",
    api_key: "",
    default_model: d?.model ?? "",
    default_params_json: "{}",
    enabled: true,
  };
}

type TestResult = { success: boolean; latency_ms: number; sample_text?: string; error?: string };

export default function ModelProvidersPage() {
  const [list, setList] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // 5.15up · 大模型 API / 智能体 API 两 tab
  const [activeTab, setActiveTab] = useState<ApiCategory>("model");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyFormFor("model"));
  const [saving, setSaving] = useState(false);

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

  function openCreate() {
    setEditingId(null);
    setForm(emptyFormFor(activeTab));
    setEditorOpen(true);
  }

  function openEdit(p: Provider) {
    setEditingId(p.id);
    setForm({
      provider_code: p.provider_code,
      name: p.name,
      platform: p.platform,
      category: catOf(p.category),
      api_endpoint: p.api_endpoint,
      api_key: "", // 留空 = 不修改
      default_model: p.default_model,
      default_params_json: JSON.stringify(p.default_params ?? {}, null, 2),
      enabled: p.enabled,
    });
    setEditorOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
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
        setSaving(false);
        return;
      }

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

      let res: Response;
      if (editingId) {
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
          headers: { "Content-Type": "application/json" },
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
    } finally {
      setSaving(false);
    }
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
            <Button onClick={openCreate} className="flex items-center gap-1.5">
              <Plus size={16} /> 新增{CATEGORY_LABEL[activeTab]}
            </Button>
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
                  <th className="px-4 py-3 text-left font-medium">平台</th>
                  <th className="px-4 py-3 text-left font-medium">API Key</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((p) => {
                  const tr = testResults[p.id];
                  return (
                    <tr key={p.id} className={p.enabled ? "" : "opacity-50"}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.provider_code}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {PLATFORM_LABEL[p.platform]?.split("（")[0] ?? p.platform}
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
                              不在凭证里，无法在此层测试 —— 故仅大模型 API 显示「测试」 */}
                          {activeTab === "model" && (
                            <button
                              onClick={() => testConnect(p)}
                              disabled={!p.enabled || !p.has_api_key || testingId === p.id}
                              className="text-xs text-[#002FA7] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1"
                              title="测试连通性"
                            >
                              {testingId === p.id
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Activity size={12} />}
                              测试
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(p)}
                            className="text-xs text-gray-600 hover:text-[#002FA7] inline-flex items-center gap-1"
                          >
                            <Edit size={12} /> 编辑
                          </button>
                          <button
                            onClick={() => toggleEnabled(p)}
                            className="text-xs text-gray-600 hover:text-amber-600"
                          >
                            {p.enabled ? "禁用" : "启用"}
                          </button>
                          {p.has_api_key && (
                            <button
                              onClick={() => clearKey(p)}
                              className="text-xs text-gray-500 hover:text-orange-600"
                              title="清空 API Key"
                            >
                              清空Key
                            </button>
                          )}
                          <button
                            onClick={() => remove(p)}
                            className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
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
                <label className="text-xs text-gray-500">平台类型 *</label>
                <select
                  value={form.platform}
                  onChange={(e) => {
                    const newPlatform = e.target.value;
                    const oldDefaults = PLATFORM_DEFAULTS[form.platform];
                    const newDefaults = PLATFORM_DEFAULTS[newPlatform];
                    // 仅当 endpoint/model 还是旧平台的默认值时，才覆盖为新平台的默认值
                    // （用户手填过的内容不被覆盖）
                    setForm({
                      ...form,
                      platform: newPlatform,
                      api_endpoint:
                        !form.api_endpoint || form.api_endpoint === oldDefaults?.endpoint
                          ? newDefaults?.endpoint ?? ""
                          : form.api_endpoint,
                      default_model:
                        !form.default_model || form.default_model === oldDefaults?.model
                          ? newDefaults?.model ?? ""
                          : form.default_model,
                    });
                  }}
                  className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                >
                  {PLATFORM_OPTIONS.filter((p) => p.category === form.category).map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

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

              {/* 默认模型 / 默认参数仅对「大模型 API」有意义；
                  「智能体 API」（Coze/Dify/元器/清言）模型与参数都在平台侧 bot 上配，
                  这里只是一个平台凭证，不显示这两个字段 */}
              {(form.category === "model" || form.category === "embedding") && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-gray-500">默认模型</label>
                    <input
                      type="text"
                      value={form.default_model}
                      onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                      placeholder="gpt-4o-mini"
                      className="h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono"
                    />
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
              <Button onClick={save} loading={saving}>
                {editingId ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
