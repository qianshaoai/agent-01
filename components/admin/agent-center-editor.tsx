"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Plug, Save, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { parseAdvancedJson, schemaForPlatform, validateNumberField } from "@/lib/platform-param-schema";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";

type CreationType = "external_link" | "external_api";
type Category = { id: string; name: string; icon_url?: string | null };
type ApiProvider = { id: string; name: string; platform: string; enabled: boolean };
type AgentDetail = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
  agent_type: string;
  external_url: string;
  provider_id: string | null;
  model_params: Record<string, unknown> | null;
  published_from_draft_id: string | null;
  categoryIds: string[];
};

const PLATFORM_OPTIONS = [
  { value: "coze", label: "Coze" },
  { value: "dify", label: "Dify" },
  { value: "qingyan", label: "清言" },
  { value: "yuanqi", label: "元器" },
  { value: "openai", label: "OpenAI" },
  { value: "zhipu", label: "智谱" },
  { value: "anthropic", label: "Anthropic" },
  { value: "other", label: "其他" },
];

const AGENT_API_PLATFORMS = new Set(["coze", "dify", "yuanqi", "qingyan"]);

function createCode(type: CreationType) {
  const prefix = type === "external_api" ? "API" : "LINK";
  return `AGT-${prefix}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function categoryForPlatform(platform: string) {
  return AGENT_API_PLATFORMS.has(platform) ? "agent" : "model";
}

function platformLabel(value: string) {
  return PLATFORM_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function splitParamsBySchema(params: Record<string, unknown>, platform: string) {
  const schema = schemaForPlatform(platform);
  const schemaKeys = new Set(schema.fields.map((field) => field.key));
  const inputs: Record<string, string> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (schemaKeys.has(key)) inputs[key] = value === null || value === undefined ? "" : String(value);
    else extra[key] = value;
  }
  return {
    inputs,
    advancedJson: Object.keys(extra).length > 0 ? JSON.stringify(extra, null, 2) : "",
  };
}

export function AgentCenterEditor({ agentId }: { agentId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const saveGuard = useSubmitGuard();
  const requestedType: CreationType = searchParams.get("type") === "external_api" ? "external_api" : "external_link";
  const [loadedType, setLoadedType] = useState<CreationType | null>(null);
  const creationType = loadedType ?? requestedType;
  const isEditing = Boolean(agentId);
  const schema = useMemo(() => schemaForPlatform(creationType === "external_api" ? "coze" : "external"), [creationType]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [agentLoading, setAgentLoading] = useState(Boolean(agentId));
  const [apiProviders, setApiProviders] = useState<ApiProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [agentCode, setAgentCode] = useState(() => createCode(creationType));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [externalUrl, setExternalUrl] = useState("");
  const [platform, setPlatform] = useState("coze");
  const [providerId, setProviderId] = useState("");
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});
  const [advancedJson, setAdvancedJson] = useState("");
  const [formError, setFormError] = useState("");

  const selectedProvider = useMemo(() => {
    return apiProviders.find((provider) => provider.id === providerId) ?? null;
  }, [apiProviders, providerId]);

  const effectivePlatform = selectedProvider?.platform ?? platform;

  const effectiveSchema = useMemo(() => {
    return creationType === "external_api" ? schemaForPlatform(effectivePlatform) : schema;
  }, [creationType, effectivePlatform, schema]);

  useEffect(() => {
    if (isEditing) return;
    setAgentCode(createCode(creationType));
    setFormError("");
  }, [creationType, isEditing]);

  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    setAgentLoading(true);
    fetch(`/api/admin/agents/${agentId}`, { cache: "no-store" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!alive) return;
        if (!ok) throw new Error(data.error ?? "加载失败");
        const agent = data as AgentDetail;
        if (agent.published_from_draft_id) {
          router.replace(`/admin/agent-builder/${agent.published_from_draft_id}`);
          return;
        }
        const nextType: CreationType = agent.agent_type === "external" ? "external_link" : "external_api";
        const split = splitParamsBySchema(agent.model_params ?? {}, agent.platform);
        setLoadedType(nextType);
        setAgentCode(agent.agent_code ?? "");
        setName(agent.name ?? "");
        setDescription(agent.description ?? "");
        setCategoryIds(Array.isArray(agent.categoryIds) ? agent.categoryIds : []);
        setExternalUrl(agent.external_url ?? "");
        setPlatform(nextType === "external_api" ? agent.platform || "coze" : "coze");
        setProviderId(agent.provider_id ?? "");
        setParamInputs(split.inputs);
        setAdvancedJson(split.advancedJson);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "加载失败";
        setFormError(msg);
        toast(msg, "error");
      })
      .finally(() => {
        if (alive) setAgentLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [agentId, router, toast]);

  useEffect(() => {
    let alive = true;
    setCategoriesLoading(true);
    fetch("/api/admin/categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        setCategories(rows);
      })
      .catch(() => {
        if (alive) setCategories([]);
      })
      .finally(() => {
        if (alive) setCategoriesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setParamInputs((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const field of effectiveSchema.fields) next[field.key] = prev[field.key] ?? "";
      return next;
    });
  }, [effectiveSchema]);

  useEffect(() => {
    if (creationType !== "external_api") return;
    let alive = true;
    setProvidersLoading(true);
    fetch(`/api/admin/model-providers?category=${categoryForPlatform(platform)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const rows: ApiProvider[] = Array.isArray(data?.data) ? data.data : [];
        setApiProviders(rows);
        setProviderId((prev) => rows.some((provider) => provider.id === prev) ? prev : "");
      })
      .catch(() => {
        if (!alive) return;
        setApiProviders([]);
        setProviderId("");
      })
      .finally(() => {
        if (alive) setProvidersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [creationType, platform]);

  function toggleCategory(id: string) {
    setCategoryIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function buildModelParams() {
    const advanced = parseAdvancedJson(advancedJson);
    if (!advanced.ok) return advanced;
    const params: Record<string, unknown> = { ...advanced.value };
    for (const field of effectiveSchema.fields) {
      const raw = paramInputs[field.key] ?? "";
      if (field.required && !raw.trim()) {
        return { ok: false as const, msg: `请填写${field.label}` };
      }
      if (!raw.trim()) continue;
      if (field.type === "number") {
        const parsed = validateNumberField(field, raw);
        if (!parsed.ok) return parsed;
        if (Number.isFinite(parsed.value)) params[field.key] = parsed.value;
      } else {
        params[field.key] = raw.trim();
      }
    }
    return { ok: true as const, value: params };
  }

  async function save() {
    setFormError("");
    const trimmedCode = agentCode.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      setFormError("请填写智能体编号");
      return;
    }
    if (!trimmedName) {
      setFormError("请填写智能体名称");
      return;
    }
    if (creationType === "external_link" && !validUrl(externalUrl.trim())) {
      setFormError("请填写有效的跳转链接");
      return;
    }
    const params = creationType === "external_api" ? buildModelParams() : { ok: true as const, value: {} };
    if (!params.ok) {
      setFormError(params.msg);
      return;
    }

    await saveGuard.submit(async (idempotencyKey) => {
      try {
        const payload = creationType === "external_link"
          ? {
              agentCode: trimmedCode,
              name: trimmedName,
              description: description.trim(),
              categoryIds,
              platform: "external",
              agentType: "external",
              externalUrl: externalUrl.trim(),
            }
          : {
              agentCode: trimmedCode,
              name: trimmedName,
              description: description.trim(),
              categoryIds,
              platform: effectivePlatform,
              agentType: "chat",
              providerId,
              modelParams: params.value,
            };
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (!isEditing) headers["Idempotency-Key"] = idempotencyKey;
        const res = await fetch(isEditing && agentId ? `/api/admin/agents/${agentId}` : "/api/admin/agents", {
          method: isEditing ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "保存失败");
        toast(isEditing ? "智能体已更新" : "智能体已创建");
        router.push("/admin/agent-center");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "保存失败";
        setFormError(msg);
        toast(msg, "error");
      }
    });
  }

  const title = isEditing
    ? creationType === "external_api" ? "编辑外部接入智能体" : "编辑外链跳转智能体"
    : creationType === "external_api" ? "新增外部接入智能体" : "新增外链跳转智能体";
  const headerIcon = creationType === "external_api" ? <Plug size={20} /> : <ExternalLink size={20} />;

  if (agentLoading) {
    return (
      <div className="max-w-[1100px] space-y-6">
        <PageHeader icon={headerIcon} title="加载智能体" subtitle="智能体管理" />
        <Card padding="lg" className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-[10px] bg-gray-50" />
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] space-y-6">
      <PageHeader
        icon={headerIcon}
        title={title}
        subtitle="智能体管理"
        actions={
          <Link
            href="/admin/agent-center"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            <ArrowLeft size={16} /> 返回
          </Link>
        }
      />

      <Card padding="lg" className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="智能体编号" value={agentCode} onChange={(e) => setAgentCode(e.target.value)} />
          <Input label="名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入智能体名称" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-gray-700">简介</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-[12px] border border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-[#002FA7] focus:outline-none focus:ring-2 focus:ring-[#002FA7]/10"
            placeholder="请输入简介"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-medium text-gray-700">
            <Tag size={14} /> 标签
          </div>
          {categoriesLoading ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-[10px] bg-gray-50" />)}
            </div>
          ) : categories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => {
                const checked = categoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-all ${
                      checked
                        ? "border-[#002FA7]/30 bg-[#002FA7]/8 text-[#002FA7]"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${checked ? "bg-[#002FA7]" : "bg-gray-300"}`} />
                    {category.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">暂无标签</p>
          )}
        </div>

        {creationType === "external_link" ? (
          <div className="rounded-[16px] border border-orange-100 bg-orange-50/30 p-4">
            <Input
              label="跳转链接 URL"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://example.com/tool"
              icon={<ExternalLink size={16} />}
            />
          </div>
        ) : (
          <div id="api-config" className="scroll-mt-6 rounded-[16px] border border-violet-100 bg-violet-50/30 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">接入平台</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="h-10 rounded-[10px] border border-gray-200 bg-white px-3.5 text-sm text-gray-900 transition-all focus:border-[#002FA7] focus:outline-none focus:ring-2 focus:ring-[#002FA7]/10"
                >
                  {PLATFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">命名 API</label>
                <select
                  value={providerId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const provider = apiProviders.find((item) => item.id === nextId);
                    setProviderId(nextId);
                    if (provider?.platform) setPlatform(provider.platform);
                  }}
                  className="h-10 rounded-[10px] border border-gray-200 bg-white px-3.5 text-sm text-gray-900 transition-all focus:border-[#002FA7] focus:outline-none focus:ring-2 focus:ring-[#002FA7]/10"
                >
                  <option value="">{providersLoading ? "加载中..." : "未绑定"}</option>
                  {apiProviders.map((provider) => (
                    <option key={provider.id} value={provider.id} disabled={!provider.enabled}>
                      {provider.name}（{platformLabel(provider.platform)}）{provider.enabled ? "" : " · 已禁用"}
                    </option>
                  ))}
                </select>
                <Link href="/admin/model-providers" className="w-fit text-xs text-[#002FA7] hover:underline">
                  去 API 管理新建 / 更新 API
                </Link>
              </div>
              {effectiveSchema.fields.map((field) => (
                <Input
                  key={field.key}
                  label={field.required ? `${field.label} *` : field.label}
                  type={field.type === "number" ? "number" : field.type === "password" ? "password" : "text"}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={paramInputs[field.key] ?? ""}
                  onChange={(e) => setParamInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                />
              ))}
            </div>
            {effectiveSchema.fields.length === 0 && effectiveSchema.noFieldsHint && (
              <p className="mt-3 rounded-[10px] bg-white px-3 py-2 text-xs text-gray-500">{effectiveSchema.noFieldsHint}</p>
            )}
            {(!effectiveSchema.hideJsonIfEmpty || advancedJson.trim().length > 0) && (
              <div className="mt-4 flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">高级参数 JSON</label>
                <textarea
                  rows={4}
                  value={advancedJson}
                  onChange={(e) => setAdvancedJson(e.target.value)}
                  className="w-full resize-none rounded-[12px] border border-gray-200 bg-white px-3.5 py-3 font-mono text-sm text-gray-900 transition-all placeholder:text-gray-400 focus:border-[#002FA7] focus:outline-none focus:ring-2 focus:ring-[#002FA7]/10"
                  placeholder="{}"
                />
              </div>
            )}
          </div>
        )}

        {formError && (
          <div className="rounded-[12px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-5">
          <Button variant="ghost" onClick={() => router.push("/admin/agent-center")}>取消</Button>
          <Button onClick={save} loading={saveGuard.loading}>
            <Save size={16} /> {isEditing ? "保存修改" : "保存"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
