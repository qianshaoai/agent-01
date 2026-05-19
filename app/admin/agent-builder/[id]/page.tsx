"use client";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CheckCircle2, Save, Send, MessageSquare,
  Settings2, Bot, Sparkles, ChevronRight, Loader2, X, Eraser, Rocket, ExternalLink, HelpCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

type TestMsg = { role: "user" | "assistant"; content: string };

// 5.14up PR-B · 智能体搭建器编辑页
// 5 个分区：基础信息 / 模型设置 / 提示词设置 / 对话体验 / 发布设置
// 右侧"测试聊天"区域占位（PR-C 实现），底部"发布"按钮 disabled（PR-C 实现）

type Provider = {
  id: string;
  name: string;
  platform: string;
  default_model: string;
  enabled: boolean;
  has_api_key: boolean;
};

type BuilderConfig = {
  system_prompt: string;
  opening_message: string;
  suggested_questions: string[];
  capabilities: {
    file_upload: boolean;
    image_input: boolean;
  };
};

type VisibilityConfig = {
  visible_to: "owner_only" | "org" | "all" | "custom";
  scope: unknown[];
};

type ModelParams = {
  temperature?: number;
  max_tokens?: number;
  [k: string]: unknown;
};

type Draft = {
  id: string;
  source_agent_id: string | null;
  name: string;
  description: string;
  category_ids: string[];
  provider_id: string | null;
  agent_type: "chat" | "external";
  external_url: string;
  builder_config: BuilderConfig;
  model_params: ModelParams;
  visibility_config: VisibilityConfig;
  status: "draft" | "testing" | "published" | "archived";
  published_agent_id: string | null;
  created_at: string;
  updated_at: string;
  // 前端临时字段：suggested_questions 文本框 string 形式（保存时按行拆成 array 写入 builder_config）
  suggested_questions_string?: string;
};

// 5.15up · 各平台预设模型列表（按免费 → 性价比 → 旗舰排序）
// 没列在这里的模型可在下方选"自定义模型名"手填
const PLATFORM_MODELS: Record<string, { value: string; label: string }[]> = {
  zhipu: [
    { value: "glm-4-flash", label: "GLM-4-Flash（免费 · 推荐）" },
    { value: "glm-4-air", label: "GLM-4-Air（性价比）" },
    { value: "glm-4-plus", label: "GLM-4-Plus（旗舰）" },
    { value: "glm-4", label: "GLM-4（旗舰）" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o-mini（便宜快速）" },
    { value: "gpt-4o", label: "GPT-4o（旗舰）" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5-turbo（经典）" },
    { value: "gpt-4-turbo", label: "GPT-4-turbo" },
  ],
  // 扣子 / Dify / 元器 / 清言 走 bot_id / assistant_id，不通过 model 字段选型
  coze: [],
  dify: [],
  yuanqi: [],
  qingyan: [],
};

function defaultBuilderConfig(): BuilderConfig {
  return {
    system_prompt: "",
    opening_message: "",
    suggested_questions: [],
    capabilities: { file_upload: true, image_input: true },
  };
}

function defaultVisibilityConfig(): VisibilityConfig {
  return { visible_to: "owner_only", scope: [] };
}

export default function AgentBuilderEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false); // 5.16up · 上次自动保存是否失败
  const [showHelp, setShowHelp] = useState(false);

  // PR-C · 测试聊天 state
  const [testHistory, setTestHistory] = useState<TestMsg[]>([]);
  const [testInput, setTestInput] = useState("");
  const [testStreaming, setTestStreaming] = useState(false);
  const [testStreamingText, setTestStreamingText] = useState("");
  const [testError, setTestError] = useState<string | null>(null);
  const [testAbort, setTestAbort] = useState<AbortController | null>(null);

  // PR-C · 发布 state
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    agent_id: string;
    agent_code: string | null;
    republish: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [draftRes, provRes] = await Promise.all([
        fetch(`/api/admin/agent-drafts/${id}`, { cache: "no-store" }),
        // 5.16up 回归修复 · 搭建器只建模型对话型智能体 → 只列 category=model 的供应商，
        // 不混入 coze / 元器 / 清言等智能体平台 API（category=agent）
        fetch(`/api/admin/model-providers?category=model`, { cache: "no-store" }),
      ]);
      const draftData = await draftRes.json();
      const provData = await provRes.json();
      if (!draftRes.ok) throw new Error(draftData.error ?? "草稿加载失败");
      if (!provRes.ok) throw new Error(provData.error ?? "供应商加载失败");

      // 兜底：旧草稿 builder_config / visibility_config 可能空
      const d = draftData as Draft;
      d.builder_config = { ...defaultBuilderConfig(), ...(d.builder_config ?? {}) };
      d.builder_config.capabilities = {
        ...defaultBuilderConfig().capabilities,
        ...(d.builder_config.capabilities ?? {}),
      };
      d.visibility_config = { ...defaultVisibilityConfig(), ...(d.visibility_config ?? {}) };
      d.suggested_questions_string = (d.builder_config.suggested_questions ?? []).join("\n");

      setDraft(d);
      setProviders((provData.data ?? []) as Provider[]);
      setDirty(false);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "加载失败", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  function patchDraft(updater: (d: Draft) => Draft) {
    setDraft((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
    setSaveError(false); // 编辑即清除上次保存失败态，放行自动保存重试
  }

  async function save(opts?: { auto?: boolean }) {
    if (!draft) return;
    setSaving(true);
    try {
      // suggested_questions 文本框 → 数组
      const sq = (draft.suggested_questions_string ?? "")
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const payload = {
        name: draft.name,
        description: draft.description,
        provider_id: draft.provider_id,
        agent_type: draft.agent_type,
        external_url: draft.external_url,
        builder_config: {
          ...draft.builder_config,
          suggested_questions: sq,
        },
        model_params: draft.model_params,
        visibility_config: draft.visibility_config,
      };
      const res = await fetch(`/api/admin/agent-drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      setDirty(false);
      setSaveError(false);
      if (!opts?.auto) toast("草稿已保存", "success");
    } catch (e: unknown) {
      setSaveError(true);
      toast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  // 离开页面前提醒未保存
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  // 5.16up · 草稿自动保存：内容变化后防抖 1.5s 落库。
  // 保存失败则停下（不循环重试刷 toast），待下次编辑或点状态条手动重试。
  useEffect(() => {
    if (!draft || !dirty || saving || saveError) return;
    const t = setTimeout(() => { void save({ auto: true }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, saving, saveError]);

  // ─── PR-C · 测试聊天 ───────────────────────────────────────
  async function sendTestChat() {
    if (!draft) return;
    const text = testInput.trim();
    if (!text || testStreaming) return;
    // 5.16up · 自动保存：测试前把未落库的改动刷一遍，确保测的是最新配置
    if (dirty) await save({ auto: true });
    if (draft.agent_type !== "chat") {
      toast("外链型智能体不支持测试聊天", "error");
      return;
    }
    if (!draft.provider_id) {
      toast("请先在「模型设置」选择模型供应商", "error");
      return;
    }

    const userMsg: TestMsg = { role: "user", content: text };
    const history = [...testHistory, userMsg];
    setTestHistory(history);
    setTestInput("");
    setTestStreaming(true);
    setTestStreamingText("");
    setTestError(null);

    const abort = new AbortController();
    setTestAbort(abort);

    try {
      const res = await fetch(`/api/admin/agent-drafts/${id}/test-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: testHistory, // 不含刚加的 userMsg，server 端会在末尾追加
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `测试请求失败（HTTP ${res.status}），请稍后重试`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.text) {
              acc += obj.text;
              setTestStreamingText(acc);
            } else if (obj.error) {
              throw new Error(obj.error);
            }
          } catch {
            // 单行 JSON 解析失败忽略
          }
        }
      }

      // 流结束 → 把 acc 落到 history
      if (acc) {
        setTestHistory([...history, { role: "assistant", content: acc }]);
      } else {
        setTestError("模型没有返回内容。请检查「模型设置」里的供应商 / 模型是否可用，或稍后重试。");
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "测试失败";
      if (errMsg !== "AbortError" && !errMsg.includes("aborted")) {
        setTestError(errMsg);
      }
    } finally {
      setTestStreaming(false);
      setTestStreamingText("");
      setTestAbort(null);
    }
  }

  function stopTestChat() {
    if (testAbort) {
      testAbort.abort();
    }
  }

  function clearTestChat() {
    if (testStreaming) {
      toast("请先停止当前测试再清空", "error");
      return;
    }
    setTestHistory([]);
    setTestError(null);
    setTestStreamingText("");
  }

  // ─── PR-C · 发布 ───────────────────────────────────────────
  async function doPublish() {
    if (!draft) return;
    // 5.16up · 自动保存：发布前刷盘（publish 接口读 DB 里的草稿）
    if (dirty) await save({ auto: true });
    setPublishing(true);
    try {
      const res = await fetch(`/api/admin/agent-drafts/${id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "发布失败");
      setPublishResult({
        agent_id: data.agent_id,
        agent_code: data.agent_code ?? null,
        republish: data.republish ?? false,
      });
      // 重新拉草稿，更新 status
      load();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "发布失败", "error");
      setPublishOpen(false);
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !draft) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="animate-spin mr-2" size={20} /> 加载中…
        </div>
      </AdminLayout>
    );
  }

  const enabledProviders = providers.filter((p) => p.enabled && p.has_api_key);
  const selectedProvider = providers.find((p) => p.id === draft.provider_id);

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* 顶部 */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/admin/agent-builder"
              className="text-gray-500 hover:text-[#002FA7] inline-flex items-center gap-1 text-sm shrink-0"
            >
              <ArrowLeft size={14} /> 返回列表
            </Link>
            <div className="text-gray-300">/</div>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patchDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="智能体名称"
              className="text-lg font-semibold text-gray-900 bg-transparent border-0 border-b border-transparent hover:border-gray-200 focus:border-[#002FA7] focus:outline-none px-1 py-0.5 min-w-0 flex-1"
            />          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="px-3 h-9 rounded-[8px] text-sm text-gray-500 hover:text-[#002FA7] hover:bg-[#002FA7]/5 inline-flex items-center gap-1.5"
              title="查看搭建器使用说明"
            >
              <HelpCircle size={14} /> 使用说明
            </button>
            <button
              onClick={() => {
                setPublishOpen(true);
                setPublishResult(null);
              }}
              disabled={saving || draft.status === "archived"}
              className="px-3 h-9 rounded-[8px] text-sm text-[#002FA7] bg-white border border-[#002FA7] hover:bg-[#002FA7]/5 disabled:text-gray-400 disabled:border-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              title="把当前草稿发布为正式智能体"
            >
              <Rocket size={14} /> 发布
            </button>
            {/* 5.16up · 草稿自动保存：此处是保存状态条，点击可立即保存 / 失败时重试 */}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              title="草稿每次改动后自动保存；点此可立即保存"
              className="px-3 h-9 rounded-[8px] text-sm inline-flex items-center gap-1.5 text-gray-500 hover:bg-gray-100 disabled:cursor-default"
            >
              <Save size={14} className="shrink-0" />
              <span className={saveError ? "text-red-600" : dirty ? "text-amber-600" : "text-green-600"}>
                {saving ? "保存中…" : saveError ? "保存失败 · 点击重试" : dirty ? "待自动保存…" : "已保存"}
              </span>
            </button>
          </div>
        </div>

        {showHelp && (
          <div className="card p-4 bg-[#f0f4ff] border border-[#002FA7]/15">
            <div className="flex items-start gap-2 text-sm text-gray-600">
              <HelpCircle size={16} className="text-[#002FA7] mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-gray-800">搭建器使用说明</p>
                <p>按 5 个分区从上到下填：① 基础信息 → ② 模型设置 → ③ 提示词设置 → ④ 对话体验 → ⑤ 发布设置。</p>
                <p>草稿改动会<strong className="text-gray-700">自动保存</strong>；用右侧「测试聊天」验证效果，确认无误后点「发布」。</p>
                <p>发布后即对授权范围内的员工开放，无需额外启用。</p>
              </div>
            </div>
          </div>
        )}

        {/* 左右两栏：左 = 配置；右 = 测试聊天（占位） */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          {/* 左侧：配置表单 */}
          <div className="space-y-4">
            {/* 分区 1：基础信息 */}
            <section className="card p-5">
              <SectionTitle icon={<Bot size={16} />} title="1. 基础信息" desc="智能体的名字和简介，员工在前台一眼看到的就是这里。" />
              <div className="space-y-3 mt-3">
                <Field label="智能体名称 *" hint="员工在前台看到的名字，建议简短易记">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => patchDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="例如：客服小助手、合同审阅助手"
                    className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                  />
                </Field>
                <Field label="简介">
                  <textarea
                    value={draft.description}
                    onChange={(e) => patchDraft((d) => ({ ...d, description: e.target.value }))}
                    rows={2}
                    placeholder="一句话介绍这个智能体能做什么"
                    className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                  />
                </Field>
                {/* 5.15up · 智能体类型选择已删除 —— 搭建器只生产对话型（chat）智能体
                    外链跳转型由旧 agents 表保留数据，不通过搭建器创建 */}
              </div>
            </section>

            {/* 分区 2：模型设置（仅对话型显示） */}
            {draft.agent_type === "chat" && (
              <section className="card p-5">
                <SectionTitle icon={<Settings2 size={16} />} title="2. 模型设置" desc="选择由哪个供应商、哪个模型来驱动这个智能体。" />
                <div className="space-y-3 mt-3">
                  <Field label="模型供应商 *">
                    <select
                      value={draft.provider_id ?? ""}
                      onChange={(e) => patchDraft((d) => ({ ...d, provider_id: e.target.value || null }))}
                      className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                    >
                      <option value="">请选择已启用的供应商…</option>
                      {enabledProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} （{p.platform} · {p.default_model || "无默认模型"}）
                        </option>
                      ))}
                    </select>
                    {enabledProviders.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        当前没有可用供应商。请先去
                        <Link href="/admin/model-providers" className="underline mx-1">模型接入</Link>
                        添加并启用。
                      </p>
                    )}
                    {selectedProvider && (
                      <p className="text-[11px] text-gray-400 mt-1">
                        默认模型：<code className="font-mono">{selectedProvider.default_model || "未设置"}</code>
                      </p>
                    )}
                  </Field>

                  <Field label="模型名称（不选用供应商默认）">
                    {(() => {
                      const presets = PLATFORM_MODELS[selectedProvider?.platform ?? ""] ?? [];
                      const currentModel = (draft.model_params.model as string) ?? "";
                      const isCustom = currentModel && !presets.find((p) => p.value === currentModel);
                      const selectValue = !currentModel ? "" : isCustom ? "__custom__" : currentModel;
                      return (
                        <>
                          {presets.length > 0 ? (
                            <select
                              value={selectValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "__custom__") return; // 切到自定义时不动 model，让下方 input 接管
                                patchDraft((d) => ({
                                  ...d,
                                  model_params: { ...d.model_params, model: v || undefined },
                                }));
                              }}
                              className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                            >
                              <option value="">使用供应商默认（{selectedProvider?.default_model || "未设置"}）</option>
                              {presets.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.label}
                                </option>
                              ))}
                              <option value="__custom__">自定义模型名（手填）</option>
                            </select>
                          ) : (
                            <p className="text-[11px] text-gray-400 mb-1">
                              {selectedProvider ? `${selectedProvider.platform} 平台不通过 model 字段选择模型（如扣子用 bot_id），下方可手填覆盖参数。` : "请先选择供应商"}
                            </p>
                          )}
                          {(isCustom || selectValue === "__custom__" || presets.length === 0) && (
                            <input
                              type="text"
                              value={currentModel}
                              onChange={(e) => patchDraft((d) => ({
                                ...d,
                                model_params: { ...d.model_params, model: e.target.value || undefined },
                              }))}
                              placeholder={selectedProvider?.default_model || "自定义模型名，如 gpt-4o-mini"}
                              className="w-full h-9 px-3 mt-2 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono"
                            />
                          )}
                        </>
                      );
                    })()}
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="温度（0.0 - 2.0）">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={(draft.model_params.temperature as number) ?? 0.7}
                        onChange={(e) => patchDraft((d) => ({
                          ...d,
                          model_params: { ...d.model_params, temperature: Number(e.target.value) },
                        }))}
                        className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono"
                      />
                    </Field>
                    <Field label="最大输出 tokens" hint="建议 4096-16384，模型上限请参考供应商文档">
                      <input
                        type="number"
                        step="512"
                        min="100"
                        value={(draft.model_params.max_tokens as number) ?? 4096}
                        onChange={(e) => patchDraft((d) => ({
                          ...d,
                          model_params: { ...d.model_params, max_tokens: Number(e.target.value) },
                        }))}
                        className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7] font-mono"
                      />
                    </Field>
                  </div>
                </div>
              </section>
            )}

            {/* 分区 3：提示词设置（仅对话型） */}
            {draft.agent_type === "chat" && (
              <section className="card p-5">
                <SectionTitle icon={<Sparkles size={16} />} title="3. 提示词设置" desc="用系统提示词定义智能体的角色、口吻和业务规则。" />
                <div className="space-y-3 mt-3">
                  <Field label="系统提示词" hint="定义智能体的角色、口吻、业务规则">
                    <textarea
                      value={draft.builder_config.system_prompt}
                      onChange={(e) => patchDraft((d) => ({
                        ...d,
                        builder_config: { ...d.builder_config, system_prompt: e.target.value },
                      }))}
                      rows={8}
                      placeholder="例：你是一个客服助理，专门解答用户关于 XXX 产品的问题..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                    />
                  </Field>
                </div>
              </section>
            )}

            {/* 分区 4：对话体验（仅对话型） */}
            {draft.agent_type === "chat" && (
              <section className="card p-5">
                <SectionTitle icon={<MessageSquare size={16} />} title="4. 对话体验" desc="开场白、建议问题，以及是否允许上传文件 / 图片。" />
                <div className="space-y-3 mt-3">
                  <Field label="开场白" hint="员工进入对话时智能体自动说的第一句话">
                    <textarea
                      value={draft.builder_config.opening_message}
                      onChange={(e) => patchDraft((d) => ({
                        ...d,
                        builder_config: { ...d.builder_config, opening_message: e.target.value },
                      }))}
                      rows={2}
                      placeholder="例：您好，我是 XXX 助理，有什么可以帮你的？"
                      className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                    />
                  </Field>
                  <Field label="建议问题（每行一条）" hint="员工进入对话时下方展示的快捷问题">
                    <textarea
                      value={draft.suggested_questions_string ?? ""}
                      onChange={(e) => patchDraft((d) => ({ ...d, suggested_questions_string: e.target.value }))}
                      rows={4}
                      placeholder={"产品有哪些功能？\n如何使用？\n常见问题"}
                      className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                    />
                  </Field>
                  <div className="flex items-center gap-6 pt-2">
                    <CheckboxOption
                      checked={draft.builder_config.capabilities.file_upload}
                      onChange={(v) => patchDraft((d) => ({
                        ...d,
                        builder_config: {
                          ...d.builder_config,
                          capabilities: { ...d.builder_config.capabilities, file_upload: v },
                        },
                      }))}
                      label="允许上传文件"
                    />
                    <CheckboxOption
                      checked={draft.builder_config.capabilities.image_input}
                      onChange={(v) => patchDraft((d) => ({
                        ...d,
                        builder_config: {
                          ...d.builder_config,
                          capabilities: { ...d.builder_config.capabilities, image_input: v },
                        },
                      }))}
                      label="允许图片输入"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* 分区 5：发布设置 */}
            <section className="card p-5">
              <SectionTitle icon={<ChevronRight size={16} />} title="5. 发布设置" desc="设置发布后哪些用户可见；发布动作在页面右上角「发布」。" />
              <div className="space-y-3 mt-3">
                <Field label="可见范围" hint="发布后哪些用户能在前台看到这个智能体">
                  <select
                    value={draft.visibility_config.visible_to}
                    onChange={(e) => patchDraft((d) => ({
                      ...d,
                      visibility_config: {
                        ...d.visibility_config,
                        visible_to: e.target.value as VisibilityConfig["visible_to"],
                      },
                    }))}
                    className="w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm focus:outline-none focus:border-[#002FA7]"
                  >
                    <option value="owner_only">仅本人可见（推荐 · 测试期使用）</option>
                    <option value="org">本组织可见</option>
                    <option value="all">全平台可见</option>
                    <option value="custom">自定义范围（待后续完善）</option>
                  </select>
                </Field>              </div>
            </section>
          </div>

          {/* 右侧：测试聊天面板（PR-C 已实现） */}
          <aside className="lg:sticky lg:top-4 self-start">
            <div className="card p-4 flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
              <div className="flex items-center justify-between mb-2">
                <SectionTitle icon={<MessageSquare size={16} />} title="测试聊天" />
                <div className="flex items-center gap-2">
                  {selectedProvider && (
                    <span className="text-[11px] text-gray-400">
                      {selectedProvider.platform} · {(draft.model_params?.model as string) || selectedProvider.default_model || "默认"}
                    </span>
                  )}
                  <button
                    onClick={clearTestChat}
                    disabled={testHistory.length === 0 || testStreaming}
                    className="text-xs text-gray-400 hover:text-red-500 disabled:text-gray-200 disabled:cursor-not-allowed inline-flex items-center gap-1"
                    title="清空测试对话"
                  >
                    <Eraser size={12} /> 清空
                  </button>
                </div>
              </div>

              {/* 消息列表 */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 mb-2 text-sm">
                {testHistory.length === 0 && !testStreamingText && !testError && (
                  <div className="text-center text-gray-400 py-12">
                    <Bot size={28} className="mx-auto mb-2 opacity-30" />
                    <p className="text-xs">在下面发一条消息开始测试</p>
                    <p className="text-[11px] mt-1">不入正式对话历史，不扣额度</p>
                  </div>
                )}
                {testHistory.map((m, i) => (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-[10px] whitespace-pre-wrap break-words ${
                      m.role === "user"
                        ? "bg-[#002FA7] text-white ml-8"
                        : "bg-gray-100 text-gray-800 mr-8"
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
                {testStreamingText && (
                  <div className="px-3 py-2 rounded-[10px] bg-gray-100 text-gray-800 mr-8 whitespace-pre-wrap break-words">
                    {testStreamingText}
                    <span className="inline-block w-1.5 h-3 bg-gray-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                )}
                {testError && (
                  <div className="px-3 py-2 rounded-[10px] bg-red-50 text-red-600 text-xs whitespace-pre-wrap break-words mr-8">
                    {testError}
                  </div>
                )}
              </div>

              {/* 输入区 */}
              <div className="border-t border-gray-100 pt-3">
                <textarea
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendTestChat();
                    }
                  }}
                  rows={2}
                  placeholder={
                    dirty
                      ? "先保存草稿再测试…"
                      : "Enter 发送，Shift+Enter 换行"
                  }
                  disabled={testStreaming || dirty}
                  className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm resize-none focus:outline-none focus:border-[#002FA7] disabled:bg-gray-50 disabled:text-gray-400"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-gray-400">
                    {dirty
                      ? "⚠️ 有未保存修改"
                      : testHistory.length > 0
                        ? `本轮 ${testHistory.length / 2 | 0} 轮对话`
                        : "测试不入库 / 不扣额度"}
                  </p>
                  {testStreaming ? (
                    <Button size="sm" onClick={stopTestChat} className="bg-red-50 text-red-600 hover:bg-red-100 border-red-200">
                      <X size={14} /> 停止
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={sendTestChat}
                      disabled={!testInput.trim() || dirty}
                      className="flex items-center gap-1"
                    >
                      <Send size={14} /> 发送
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* 发布弹窗 */}
      {publishOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !publishing && setPublishOpen(false)}
        >
          <div
            className="bg-white rounded-[14px] shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Rocket size={18} className="text-[#002FA7]" />
              <h3 className="text-lg font-semibold text-gray-900">发布到正式智能体</h3>
            </div>

            {!publishResult ? (
              <>
                <div className="px-6 py-5 space-y-3 text-sm text-gray-700">
                  <p>把当前草稿发布到正式 <code className="text-xs bg-gray-100 px-1 rounded">agents</code> 表，员工就能在前台看到它。</p>                  {draft.status === "published" && (
                    <p className="text-xs text-gray-500">
                      该草稿之前发布过，会<strong>重新更新</strong>已有的智能体记录，不会重复创建。
                    </p>
                  )}
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={() => setPublishOpen(false)}
                    disabled={publishing}
                    className="px-4 h-9 rounded-[8px] text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <Button onClick={doPublish} loading={publishing} className="flex items-center gap-1.5">
                    <Rocket size={14} /> 确认发布
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 py-5 space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 size={18} />
                    <span className="font-medium">
                      {publishResult.republish ? "已重新发布" : "首次发布成功"}
                    </span>
                  </div>
                  <div className="text-gray-700 space-y-1">
                    <p>智能体 ID：<code className="text-xs bg-gray-100 px-1 rounded">{publishResult.agent_id}</code></p>
                    {publishResult.agent_code && (
                      <p>智能体编号：<code className="text-xs bg-gray-100 px-1 rounded">{publishResult.agent_code}</code></p>
                    )}
                    <p className="text-xs text-green-600 mt-2">
                      已发布并启用，授权范围内的员工现在就能在前台看到。
                    </p>
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
                  <Link
                    href={`/admin/agents`}
                    className="px-4 h-9 rounded-[8px] text-sm text-[#002FA7] border border-[#002FA7] hover:bg-[#002FA7]/5 inline-flex items-center gap-1.5"
                  >
                    <ExternalLink size={14} /> 去智能体管理
                  </Link>
                  <Button onClick={() => setPublishOpen(false)}>关闭</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// ─── 小组件 ────────────────────────────────────────────────────────────────
function SectionTitle({ icon, title, desc }: { icon: React.ReactNode; title: string; desc?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
        <span className="text-[#002FA7]">{icon}</span>
        {title}
      </div>
      {desc && <p className="text-[12px] text-gray-400 mt-1 pl-6">{desc}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500 font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}


function CheckboxOption({
  checked, onChange, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
