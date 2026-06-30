"use client";
import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CheckCircle2, Save, Send, MessageSquare,
  Settings2, Bot, Sparkles, ChevronRight, ChevronDown, Loader2, X, Eraser, Rocket, ExternalLink, HelpCircle,
  Library, Check,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";
import { getPresetsByCategory, type ProviderPreset } from "@/lib/model-providers/presets";

type TestMsg = { role: "user" | "assistant"; content: string };

// 5.14up PR-B · 智能体搭建器编辑页
// 6 个分区：基础信息 / 模型设置 / 提示词设置 / 对话体验 / 知识库 / 发布设置
//   （5.19up 知识库B 新增「知识库」分区）
// 右侧"测试聊天"区域占位（PR-C 实现），底部"发布"按钮 disabled（PR-C 实现）

type Provider = {
  id: string;
  name: string;
  /** 5.29up / 6.3up · 一级供应商下拉的 label 后缀（与 name 一起显示，区分同 platform 多 provider） */
  provider_code: string;
  platform: string;
  api_endpoint: string; // 5.27up · 反查厂商预设需要 endpoint host
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
  // 5.19up 知识库B · 绑定的知识库 id（搭建器「知识库」分区勾选的意图）；
  //   发布时按此全量同步到 agent_knowledge_bases 关联表
  knowledge_base_ids: string[];
};

type VisibilityConfig = {
  visible_to: "owner_only" | "org" | "all"; // 5.19up · 去掉 "custom"
  scope: string[]; // visible_to="org" 时为可见组织码数组
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

// 5.15up · 各平台预设模型列表
// 5.27up · 模型下拉清单移到 lib/model-providers/presets.ts 的 preset.recommendedModels；
// 这里按厂商（不是 platform）查 —— 修复"新加 DeepSeek/千问/豆包 等 OpenAI 兼容厂商
// 后下拉仍显示 GPT 列表"的 bug（同 platform="openai" 但模型完全不同）。
// 5.20up 验收的「绑 KB 智能体最低 glm-4-air」标注仍在 zhipu-glm preset 里。
//
// ─── 6.3up · 模型选择两级化 helpers ────────────────────────────
//   5.29up 把「供应商 + 模型」合并成一个 grouped popover，多 provider 后辨识度低
//   （同 platform / provider_code 撞名）。6.3up 回退到两级 select：
//     - buildProviderOptions: enabled providers → 一级下拉
//     - buildModelsForProvider: 给定 provider → 二级下拉（recognized preset 用其
//       recommendedModels；openai / anthropic custom endpoint 套 -official 推荐
//       兜底；其它 custom → 空）
//     - resolveProviderPresetForBuilder（保留）：host 不命中时不回落 platform 第
//       一个 preset，避免 OpenAI 兼容自定义 endpoint 错套 GPT 推荐。
//
//   5.29up 删除：自定义模型名（探针）功能已下线，6.3up 不恢复——第三方 OpenAI
//   兼容中转的 silently 路由 + /models ID 命名差异让探针几乎必误报。要加新模型
//   走 lib/model-providers/presets.ts 评审。

type CustomBuilderResolution = { kind: "custom"; label: string };
type RecognizedBuilderResolution = { kind: "recognized"; preset: ProviderPreset };
type BuilderResolution = RecognizedBuilderResolution | CustomBuilderResolution;

function customProviderLabel(provider: Provider): string {
  if (provider.platform === "openai") return "OpenAI 兼容（自定义）";
  // 防御：未来若 category=model 支持非 openai/zhipu 或 zhipu 代理 endpoint，
  // 不要误标成 OpenAI 兼容。
  return `${provider.name || provider.platform}（自定义）`;
}

function resolveProviderPresetForBuilder(provider: Provider): BuilderResolution {
  const ep = (provider.api_endpoint ?? "").trim().toLowerCase();
  if (!ep) return { kind: "custom", label: customProviderLabel(provider) };

  const all = getPresetsByCategory("model");
  const exact = all.find((p) => p.endpoint.toLowerCase() === ep);
  if (exact) return { kind: "recognized", preset: exact };

  try {
    const host = new URL(provider.api_endpoint).host.toLowerCase();
    const byHost = all.find((p) => {
      if (!p.endpoint) return false;
      try { return new URL(p.endpoint).host.toLowerCase() === host; } catch { return false; }
    });
    if (byHost) return { kind: "recognized", preset: byHost };
  } catch { /* endpoint 非合法 URL，落自定义 */ }

  // 关键：host 没匹配上 → 视为自定义端点，不回落到该 platform 的第一个 preset
  return { kind: "custom", label: customProviderLabel(provider) };
}

// 6.3up · 两级 select 选项的通用形态（不再用 ${pid}::${model} 组合 value）
type Option = { value: string; label: string };

// 5.29up · 模型显示文案：去掉 preset label 里的括号描述（"gpt-5.5（2026/04 旗舰）"
//   → "gpt-5.5"）。原始 label 在 API 管理页继续展示，搭建器下拉里只显示纯模型名。
function stripModelDesc(label: string): string {
  return label.replace(/\s*[（(].*?[）)]\s*$/g, "").trim();
}

// 6.3up · 一级下拉：可选供应商列表（enabled + 配了 key 的）
function buildProviderOptions(providers: Provider[]): Option[] {
  return providers
    .filter((p) => p.enabled && p.has_api_key)
    .map((p) => ({ value: p.id, label: `${p.name}（${p.provider_code}）` }));
}

// 6.3up · 二级下拉：给定 provider 的可选模型列表
//   - recognized preset → preset.recommendedModels
//   - openai / anthropic custom endpoint → 套 -official 推荐（5.29up Fix 4 + 5.30.1 R1#8 兜底口径）
//   - 其它 custom → 空（要加新模型走 presets.ts 评审）
function buildModelsForProvider(provider: Provider | undefined): Option[] {
  if (!provider) return [];
  const r = resolveProviderPresetForBuilder(provider);
  if (r.kind === "recognized" && r.preset.recommendedModels?.length) {
    return r.preset.recommendedModels.map((m) => ({ value: m.value, label: stripModelDesc(m.label) }));
  }
  if (r.kind === "custom") {
    const all = getPresetsByCategory("model");
    if (provider.platform === "openai") {
      const list = all.find((p) => p.code === "openai-official")?.recommendedModels ?? [];
      return list.map((m) => ({ value: m.value, label: stripModelDesc(m.label) }));
    }
    if (provider.platform === "anthropic") {
      const list = all.find((p) => p.code === "anthropic-official")?.recommendedModels ?? [];
      return list.map((m) => ({ value: m.value, label: stripModelDesc(m.label) }));
    }
  }
  return [];
}

// 5.29up R5 Fix 1 · 加载老 draft 时一次性把空 model 补成 provider 默认模型。
//   这样新 UI 展示的是实际运行时会用的 effective model，避免把"老 draft 依赖
//   provider.default_model"误解成"用户主动选了自定义但没填"。
//   注意：这里不标 dirty，只是把后端兜底值显式映射到本页状态；用户后续编辑时才保存。
function maybeSeedModelFromDefault(
  draft: Draft,
  providers: Provider[],
): Draft {
  if (draft.agent_type !== "chat") return draft;
  if (!draft.provider_id) return draft;
  const existing = (draft.model_params?.model as string | undefined)?.trim();
  if (existing) return draft;
  const provider = providers.find((p) => p.id === draft.provider_id);
  if (!provider || !provider.default_model) return draft;
  return {
    ...draft,
    model_params: { ...draft.model_params, model: provider.default_model },
  };
}

// 5.29up Phase 2.3 · 保存/发布前的模型字段校验
//   - external 类型不校验（不依赖 provider 与 model）
//   - chat 类型必须有 provider_id；effective model = draft.model || provider.default_model
//   - effective model 为空才阻断（防上线后 chat 兜底 gpt-4o-mini → 非 OpenAI 厂商 404）
function validateModelBeforeSave(draft: Draft, providers: Provider[]): string | null {
  if (draft.agent_type !== "chat") return null;
  if (!draft.provider_id) return "请先在「模型设置」选择模型";
  const model = ((draft.model_params?.model as string) ?? "").trim();
  const provider = providers.find((p) => p.id === draft.provider_id);
  const effective = model || (provider?.default_model ?? "").trim();
  if (!effective) return "请在「模型选择」里挑一个模型";
  return null;
}

// ─── 6.3up · 通用单层 select popover ─────────────────────────────────────
// 复用 5.29up popover 风格（按钮 + 浮层 + 点击外部/Esc 关闭 + 选中项高亮 ✓）。
// 单层 Option[]，无分组 sticky 标题。两级 select（供应商 / 模型）共用。
function SimpleSelectPopover({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  emptyHint = "暂无可选项",
}: {
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const buttonLabel = current?.label ?? placeholder;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`w-full h-9 px-3 border border-gray-200 rounded-[8px] text-sm flex items-center justify-between hover:border-[#002FA7] focus:outline-none focus:border-[#002FA7] transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed ${open ? "border-[#002FA7]" : ""}`}
      >
        <span className={current ? "text-gray-900 truncate" : "text-gray-400 truncate"}>
          {buttonLabel}
        </span>
        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        // 5-6 行可视高度：每行 ~36px → max-h-[220px] 给 6 行；超出滚轮滑动
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,0.12)] max-h-[220px] overflow-y-auto py-1">
          {options.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">{emptyHint}</p>
          ) : (
            options.map((o) => {
              const isCurrent = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                    isCurrent
                      ? "bg-[#002FA7]/8 text-[#002FA7] font-medium"
                      : "text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {isCurrent && <Check size={13} className="text-[#002FA7] shrink-0 ml-2" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function defaultBuilderConfig(): BuilderConfig {
  return {
    system_prompt: "",
    opening_message: "",
    suggested_questions: [],
    capabilities: { file_upload: true, image_input: true },
    knowledge_base_ids: [],
  };
}

function defaultVisibilityConfig(): VisibilityConfig {
  return { visible_to: "owner_only", scope: [] };
}

// 5.19up · 拉全量组织（tenants 接口默认分页 100，循环拉完，供"指定组织可见"多选）
async function fetchAllTenants(): Promise<{ code: string; name: string }[]> {
  const all: { code: string; name: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`/api/admin/tenants?page=${page}&pageSize=100`).then((r) => r.json());
    const batch: { code: string; name: string }[] = Array.isArray(res) ? res : (res?.data ?? []);
    all.push(...batch);
    const total = res?.pagination?.total;
    if (batch.length < 100 || (typeof total === "number" && all.length >= total)) break;
  }
  return all;
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
  // 6.6up Fix · 供应商列表是否因加载失败 / 无 provider.read 权限而拿不到
  //   （区别于"确实没配过供应商"，给精确提示用）
  const [providersUnavailable, setProvidersUnavailable] = useState(false);
  // 5.19up · 组织列表（"指定组织可见"多选用）
  const [tenants, setTenants] = useState<{ code: string; name: string }[]>([]);
  // 5.19up 知识库B · 知识库列表（「知识库」分区多选用；方案A 的接口未上线时为空）
  // status 用于：disabled 库可见但禁选（避免静默丢配置），已绑 disabled 时显示告警「不参与检索」
  const [knowledgeBases, setKnowledgeBases] = useState<
    { id: string; name: string; status: "active" | "disabled" }[]
  >([]);
  // 5.19up · 当前管理员角色（org_admin 只能发"本组织可见"）
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const isOrgAdmin = adminRole === "org_admin";
  // 6.6up Fix · 发布可见范围是否按「org 范围」对待 = builtin org_admin，或 custom 角色但无 agent_draft.publish.all。
  //   与后端 publish 路由口径一致（custom && !publish.all → 强制最大本组织）。修「自定义角色被前端当平台管理员、
  //   误显示『全平台/指定组织可见』+ 空组织选择器」。
  const [isPublishOrgScoped, setIsPublishOrgScoped] = useState(false);
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
  // 5.27up Fix · 防重复提交（详见 lib/hooks/use-submit-guard.ts）
  const publishGuard = useSubmitGuard();
  const [publishResult, setPublishResult] = useState<{
    agent_id: string;
    agent_code: string | null;
    republish: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [draftRes, provRes, meRes, kbRes] = await Promise.all([
        fetch(`/api/admin/agent-drafts/${id}`, { cache: "no-store" }),
        // 5.16up 回归修复 · 搭建器只建模型对话型智能体 → 只列 category=model 的供应商，
        // 不混入 coze / 元器 / 清言等智能体平台 API（category=agent）
        // 6.6up Fix · 供应商列表拉取失败（如 custom 角色只授了 agent_draft、缺 provider.read）
        //   不再 hard-fail，降级为空列表照常打开搭建器（与下方知识库同款容错），修复
        //   「只授新建草稿权限 → 建得了草稿却打不开搭建器、误弹"权限不足"」的口径不一致。
        fetch(`/api/admin/model-providers?category=model`, { cache: "no-store" }).catch(() => null),
        // 5.19up · 当前管理员角色（决定可见范围选项）
        fetch(`/api/admin/me`, { cache: "no-store" }),
        // 5.19up 知识库B · 知识库列表（方案A 交付的接口；A 未上线时静默降级为空列表）
        fetch(`/api/admin/knowledge-bases?purpose=bind`, { cache: "no-store" }).catch(() => null),
      ]);
      const draftData = await draftRes.json();
      const meData = await meRes.json().catch(() => ({}));
      if (!draftRes.ok) throw new Error(draftData.error ?? "草稿加载失败");
      const role: string | null = meRes.ok && typeof meData?.role === "string" ? meData.role : null;
      // 6.6up Fix · 识别「发布按 org 范围对待」：builtin org_admin，或 custom 角色但无 agent_draft.publish.all
      const meSource: string | null = meRes.ok && typeof meData?.source === "string" ? meData.source : null;
      const mePerms: string[] = meRes.ok && Array.isArray(meData?.permissions) ? (meData.permissions as string[]) : [];
      const orgScopedPublish =
        role === "org_admin" ||
        (meSource === "custom_admin" && !mePerms.includes("agent_draft.publish.all"));

      // 5.19up 知识库B · 解析知识库列表：A 未交付 / 接口异常 → kbList 空、kbFetchOk=false
      // 5.19up 二轮收口 · 保留每个 KB 的 status（A 接口默认返回 active + disabled）
      let kbList: { id: string; name: string; status: "active" | "disabled" }[] = [];
      let kbFetchOk = false;
      if (kbRes && kbRes.ok) {
        try {
          const kbData = await kbRes.json();
          const arr: unknown[] = Array.isArray(kbData) ? kbData : (kbData?.data ?? []);
          kbList = arr
            .map((x) => x as { id?: unknown; name?: unknown; status?: unknown })
            .filter((x) => typeof x.id === "string")
            .map((x) => ({
              id: x.id as string,
              name: typeof x.name === "string" && x.name ? x.name : (x.id as string),
              // disabled 兜底：未传 status 或其他值都按 active 处理（防误标停用）
              status: x.status === "disabled" ? "disabled" : "active",
            }));
          kbFetchOk = true;
        } catch { /* 解析失败 → 降级为空列表 */ }
      }

      // 兜底：旧草稿 builder_config / visibility_config 可能空
      const d = draftData as Draft;
      d.builder_config = { ...defaultBuilderConfig(), ...(d.builder_config ?? {}) };
      d.builder_config.capabilities = {
        ...defaultBuilderConfig().capabilities,
        ...(d.builder_config.capabilities ?? {}),
      };
      d.visibility_config = { ...defaultVisibilityConfig(), ...(d.visibility_config ?? {}) };
      // 5.19up · 旧草稿 visible_to="custom" 已废弃 → 降级"暂不公开"（安全侧）
      if ((d.visibility_config.visible_to as string) === "custom") {
        d.visibility_config = { ...d.visibility_config, visible_to: "owner_only" };
      }
      d.suggested_questions_string = (d.builder_config.suggested_questions ?? []).join("\n");

      // 5.19up 知识库B · 过滤草稿里指向「已删除知识库」的脏 id —— 仅当 KB 列表确实拉到时才过滤；
      //   接口异常（A 未上线）时不动用户已选 id，避免误清。
      if (kbFetchOk) {
        const validKb = new Set(kbList.map((k) => k.id));
        d.builder_config.knowledge_base_ids = (d.builder_config.knowledge_base_ids ?? [])
          .filter((kid) => validKb.has(kid));
      }

      // 6.6up Fix · 供应商列表降级解析：拉取失败 / 403 → 空列表 + 标记 providersUnavailable，
      //   让搭建器照常打开，模型设置区给出"缺 API 读取权限"而非"没配供应商"的精确提示。
      let loadedProviders: Provider[] = [];
      if (provRes && provRes.ok) {
        try {
          const provData = await provRes.json();
          loadedProviders = (provData.data ?? []) as Provider[];
        } catch { /* 解析失败 → 空列表降级 */ }
        setProvidersUnavailable(false);
      } else {
        setProvidersUnavailable(true);
      }
      // 5.29up R5 Fix 1 · 加载老 draft 时把空 model 补成 provider 默认（如果默认在
      //   推荐列表里），避免新 UI 误把 "用户主动选自定义" 跟 "老 draft 空 model" 混淆。
      setDraft(maybeSeedModelFromDefault(d, loadedProviders));
      setProviders(loadedProviders);
      setKnowledgeBases(kbList);
      setAdminRole(role);
      setIsPublishOrgScoped(orgScopedPublish);
      // 5.19up · 仅平台级（super/system）需要组织列表；org 范围（org_admin / custom 无 publish.all）只发本组织、无多选
      setTenants(orgScopedPublish ? [] : await fetchAllTenants().catch(() => []));
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
    // 5.29up Phase 2.3 · 手动保存 / 发布前的空值校验（auto-save 跳过，让 admin 安心
    //   迭代不丢字）。custom 模式下 model 必填——否则上线后 chat 兜底 gpt-4o-mini，
    //   非 OpenAI 兼容厂商会 404，体感像智能体坏了。
    if (!opts?.auto) {
      const err = validateModelBeforeSave(draft, providers);
      if (err) {
        toast(err, "error");
        return;
      }
    }
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
    // 5.29up Phase 2.3 · 发布前空值校验（与 save 同口径）
    const err = validateModelBeforeSave(draft, providers);
    if (err) {
      toast(err, "error");
      return;
    }
    // 5.16up · 自动保存：发布前刷盘（publish 接口读 DB 里的草稿）
    if (dirty) await save({ auto: true });
    await publishGuard.submit(async (idempotencyKey) => {
      try {
        const res = await fetch(`/api/admin/agent-drafts/${id}/publish`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        });
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
      }
    });
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
  const boundKnowledgeBaseCount = draft.builder_config.knowledge_base_ids?.length ?? 0;
  const effectiveModel = String(
    (draft.model_params.model as string | undefined) || selectedProvider?.default_model || "",
  ).trim();
  const isKnowledgeBaseFlashModel =
    boundKnowledgeBaseCount > 0 &&
    selectedProvider?.platform === "zhipu" &&
    /^glm-4-flash\b/i.test(effectiveModel);

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
                // 5.19up · 平台级 选「指定组织可见」但未勾组织 → 拦下（org 范围无此分支）
                if (!isPublishOrgScoped && draft.visibility_config.visible_to === "org"
                    && draft.visibility_config.scope.length === 0) {
                  toast("「指定组织可见」请先勾选至少一个组织", "error");
                  return;
                }
                if (isKnowledgeBaseFlashModel) {
                  toast("已绑定知识库的智谱智能体请改用 glm-4-air 或更高模型；glm-4-flash 会反驳知识库事实", "error");
                  return;
                }
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
                <p>按 6 个分区从上到下填：① 基础信息 → ② 模型设置 → ③ 提示词设置 → ④ 对话体验 → ⑤ 知识库 → ⑥ 发布设置。</p>
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
                <SectionTitle icon={<Settings2 size={16} />} title="2. 模型设置" desc="先选大模型供应商，再选模型。" />
                <div className="space-y-3 mt-3">
                  {/* 6.3up · 两级 select ───────────────────────────────────
                      一级供应商 + 二级模型。切供应商时自动 reset model 字段
                      避免静默错配。原 5.29up 合并下拉因为同 platform 多
                      provider 时辨识度低被回退（截图反馈：claude（claude）
                      provider_code 与 platform 同名导致小字辨识度差）。 */}
                  <Field label="供应商 *">
                    <SimpleSelectPopover
                      value={draft.provider_id ?? ""}
                      options={buildProviderOptions(providers)}
                      placeholder="请选择大模型供应商…"
                      disabled={enabledProviders.length === 0}
                      emptyHint="暂无可用供应商"
                      onChange={(v) => {
                        // 6.3up · 切供应商时 reset model（决策点 2 · A）
                        patchDraft((d) => ({
                          ...d,
                          provider_id: v || null,
                          model_params: { ...d.model_params, model: undefined },
                        }));
                      }}
                    />
                    {enabledProviders.length === 0 && (
                      providersUnavailable ? (
                        <p className="text-[11px] text-amber-600 mt-1">
                          无法加载模型供应商列表（可能缺少「API 读取」权限）。可先编辑其他内容；
                          模型选择需联系管理员补授供应商读取权限后再来。
                        </p>
                      ) : (
                        <p className="text-[11px] text-amber-600 mt-1">
                          当前没有可用供应商。请先去
                          <Link href="/admin/model-providers" className="underline mx-1">模型接入</Link>
                          添加并启用。
                        </p>
                      )
                    )}
                  </Field>

                  <Field label="模型 *">
                    <SimpleSelectPopover
                      value={(draft.model_params.model as string | undefined) ?? ""}
                      options={buildModelsForProvider(selectedProvider)}
                      placeholder={selectedProvider ? "请选择模型…" : "请先选供应商"}
                      disabled={!selectedProvider}
                      emptyHint="该供应商暂无预设模型；请到 lib/model-providers/presets.ts 添加"
                      onChange={(v) => {
                        patchDraft((d) => ({
                          ...d,
                          model_params: { ...d.model_params, model: v || undefined },
                        }));
                      }}
                    />
                    {/* KB + flash 仍保留 5.20up 锁定的提示 */}
                    {isKnowledgeBaseFlashModel && (
                      <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                        已绑定知识库时不建议使用 GLM-4-Flash：验收中该模型会用常识反驳知识库事实。
                        请改为 <code className="font-mono">glm-4-air</code> 或更高模型。
                      </p>
                    )}
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="温度（0.0 - 2.0）" hint="越低越稳定准确，越高越发散有创意，日常对话建议 0.7">
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

            {/* 分区 5：知识库（仅对话型）*/}
            {draft.agent_type === "chat" && (
              <section className="card p-5">
                <SectionTitle icon={<Library size={16} />} title="5. 知识库" desc="给智能体挂知识库；对话时按用户问题自动检索相关资料、注入回答。" />
                <div className="space-y-3 mt-3">
                  <Field label="绑定知识库" hint="勾选的知识库，对话时会按用户问题检索相关片段供智能体参考；可多选。已停用的知识库不参与检索（v39 RPC 兜底过滤），但仍展示在列表里避免静默丢配置。">
                    {knowledgeBases.length === 0 ? (
                      <p className="text-xs text-gray-400">
                        {isOrgAdmin
                          ? "知识库由平台管理员统一维护。当前没有可绑定知识库，请联系超级管理员或系统管理员配置。"
                          : "暂无知识库可选。请先到「知识库管理」创建知识库并上传文档。"}
                      </p>
                    ) : (
                      <div className="border border-gray-200 rounded-[8px] p-2 max-h-44 overflow-y-auto space-y-0.5">
                        {knowledgeBases.map((kb) => {
                          const checked = (draft.builder_config.knowledge_base_ids ?? []).includes(kb.id);
                          const isDisabledKb = kb.status === "disabled";
                          // disabled 已勾：允许取消（用户清理用），不允许新加（点已不勾的 disabled 项要被拦下）
                          const canToggle = !isDisabledKb || checked;
                          return (
                            <label
                              key={kb.id}
                              className={`flex items-start gap-2 text-sm px-1 py-0.5 rounded ${
                                canToggle ? "cursor-pointer hover:bg-gray-50" : "cursor-not-allowed opacity-60"
                              }`}
                              title={
                                isDisabledKb
                                  ? checked
                                    ? "该知识库已停用，当前不参与检索；可取消勾选清理配置"
                                    : "该知识库已停用，无法新绑定"
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                className="accent-[#002FA7] mt-0.5"
                                checked={checked}
                                disabled={!canToggle}
                                onChange={() => {
                                  if (!canToggle) return;
                                  patchDraft((d) => {
                                    const cur = d.builder_config.knowledge_base_ids ?? [];
                                    return {
                                      ...d,
                                      builder_config: {
                                        ...d.builder_config,
                                        knowledge_base_ids: checked
                                          ? cur.filter((x) => x !== kb.id)
                                          : [...cur, kb.id],
                                      },
                                    };
                                  });
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <span className={isDisabledKb ? "text-gray-500" : "text-gray-700"}>{kb.name}</span>
                                {isDisabledKb && (
                                  <span className="ml-2 text-[11px] text-amber-600">
                                    {checked
                                      ? "⚠ 已停用 · 当前不参与检索（启用后才生效；或取消勾选清理）"
                                      : "已停用 · 不可绑定"}
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </Field>
                </div>
              </section>
            )}

            {/* 分区 6：发布设置 */}
            <section className="card p-5">
              <SectionTitle icon={<ChevronRight size={16} />} title="6. 发布设置" desc="设置发布后哪些用户可见；发布动作在页面右上角「发布」。" />
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
                    {!isPublishOrgScoped && <option value="all">全平台可见</option>}
                    <option value="org">{isPublishOrgScoped ? "本组织可见" : "指定组织可见"}</option>
                    <option value="owner_only">暂不公开（仅自己测试，前台不可见）</option>
                  </select>
                </Field>
                {/* 5.19up · 指定组织可见 → 组织多选（仅平台级 super/system；org 范围固定本组织、无多选）*/}
                {!isPublishOrgScoped && draft.visibility_config.visible_to === "org" && (
                  <Field label="选择可见组织" hint="勾选的组织，其成员能在前台看到这个智能体">
                    {tenants.length === 0 ? (
                      <p className="text-xs text-gray-400">暂无组织</p>
                    ) : (
                      <div className="border border-gray-200 rounded-[8px] p-2 max-h-44 overflow-y-auto space-y-0.5">
                        {tenants.map((t) => {
                          const checked = draft.visibility_config.scope.includes(t.code);
                          return (
                            <label key={t.code} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded cursor-pointer hover:bg-gray-50">
                              <input
                                type="checkbox"
                                className="accent-[#002FA7]"
                                checked={checked}
                                onChange={() => patchDraft((d) => ({
                                  ...d,
                                  visibility_config: {
                                    ...d.visibility_config,
                                    scope: checked
                                      ? d.visibility_config.scope.filter((c) => c !== t.code)
                                      : [...d.visibility_config.scope, t.code],
                                  },
                                }))}
                              />
                              <span className="text-gray-700">{t.name}</span>
                              <code className="text-[11px] text-gray-400">{t.code}</code>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </Field>
                )}
              </div>
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
                      if (testStreaming) return;
                      sendTestChat();
                    }
                  }}
                  rows={2}
                  placeholder={
                    dirty
                      ? "先保存草稿再测试…"
                      : "Enter 发送，Shift+Enter 换行"
                  }
                  disabled={dirty}
                  className="w-full px-3 py-2 border border-gray-200 rounded-[8px] text-sm resize-none focus:outline-none focus:border-[#002FA7] disabled:bg-gray-50 disabled:text-gray-400"
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-[11px] text-gray-400">
                    {dirty
                      ? "⚠️ 有未保存修改"
                      : testHistory.length > 0
                        ? `本轮 ${testHistory.length / 2 | 0} 轮对话`
                        : "测试不入库 / 不扣额度 / 不累积 KB 记忆"}
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
          onClick={() => !publishGuard.loading && setPublishOpen(false)}
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
                    <>
                      <p className="text-xs text-gray-500">
                        该草稿之前发布过，会<strong>重新更新</strong>已有的智能体记录，不会重复创建。
                      </p>
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[8px] p-2">
                        ⚠️ 发布会按搭建器「可见范围」<strong>覆盖</strong>该智能体在「智能体管理 → 权限设置」里现有的权限规则。
                      </p>
                    </>
                  )}
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    onClick={() => setPublishOpen(false)}
                    disabled={publishGuard.loading}
                    className="px-4 h-9 rounded-[8px] text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <Button onClick={doPublish} loading={publishGuard.loading} className="flex items-center gap-1.5">
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
