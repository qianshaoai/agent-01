// 6.2up · 外部平台智能体 API 配置 · 平台特定输入框 schema
// admin/agents 的「API 配置」弹窗按 effectivePlatform 渲染对应 input 列表，
// 用户不再面对 JSON。除 schema 之外的额外字段走「高级（JSON）」折叠。
//
// effectivePlatform = selectedProvider?.platform ?? agent.provider?.platform ?? agent.platform
// schema 字段保存到 model_params；非 schema key 走 advancedJson；input 优先合并。

export type ParamField = {
  key: string;
  label: string;
  type: "text" | "number" | "password";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
};

export type PlatformSchema = {
  fields: ParamField[];
  noFieldsHint?: string;
  // R1 决策点 1：dify 在 advancedJson 为空时隐藏 JSON 折叠；
  // other / default 平台 fields 为空时仍需 JSON 折叠承担唯一输入入口
  hideJsonIfEmpty?: boolean;
};

export function schemaForPlatform(platform: string): PlatformSchema {
  switch (platform) {
    case "coze":
      return {
        fields: [
          {
            key: "bot_id",
            label: "Bot ID",
            type: "text",
            required: true,
            placeholder: "如 7392...",
            hint: "在扣子 (Coze) 后台 Bot 详情页复制",
          },
        ],
      };

    case "yuanqi":
      return {
        fields: [
          {
            key: "assistant_id",
            label: "Assistant ID",
            type: "text",
            required: true,
            placeholder: "如 abc-xxx",
            hint: "在腾讯元器后台智能体详情页复制",
          },
        ],
      };

    case "qingyan":
      return {
        fields: [
          {
            key: "assistant_id",
            label: "Assistant ID",
            type: "text",
            required: true,
            placeholder: "如 65xxx",
            hint: "在智谱清言后台智能体详情页复制",
          },
          {
            key: "api_secret",
            label: "API Secret",
            type: "password",
            required: true,
            placeholder: "智谱清言 API Secret（与 API Key 配对）",
            hint: "注：智谱清言需要 API Key + API Secret 双凭证",
          },
        ],
      };

    case "dify":
      return {
        fields: [],
        noFieldsHint: "Dify 平台无需额外配置，直接绑定 API Key 即可",
        hideJsonIfEmpty: true,
      };

    case "openai":
    case "anthropic":
      return {
        fields: [
          {
            key: "model",
            label: "模型 ID",
            type: "text",
            placeholder: "（留空走 API 默认模型）",
            hint: "如 gpt-4o-mini / claude-haiku-4-5-20251001",
          },
          {
            key: "temperature",
            label: "Temperature",
            type: "number",
            placeholder: "0.7",
            min: 0,
            max: 2,
            step: 0.1,
            hint: "采样随机度。0=最稳定、2=最随机。留空走平台默认。",
          },
          {
            key: "max_tokens",
            label: "Max Tokens",
            type: "number",
            placeholder: "2000",
            min: 1,
            max: 128000,
            step: 100,
            hint: "回复最大长度（token 数）。留空走平台默认。",
          },
        ],
      };

    case "zhipu":
      return {
        fields: [
          {
            key: "model",
            label: "模型 ID",
            type: "text",
            placeholder: "（留空走 API 默认模型）",
            hint: "如 glm-4-flash / glm-4-air",
          },
          {
            key: "temperature",
            label: "Temperature",
            type: "number",
            placeholder: "0.7",
            min: 0,
            max: 1,
            step: 0.1,
            hint: "智谱采样随机度。0=最稳定、1=最随机。留空走平台默认。",
          },
          {
            key: "max_tokens",
            label: "Max Tokens",
            type: "number",
            placeholder: "2000",
            min: 1,
            max: 128000,
            step: 100,
            hint: "回复最大长度（token 数）。留空走平台默认。",
          },
        ],
      };

    case "other":
      return {
        fields: [],
        noFieldsHint: "未识别的平台，请在「高级（JSON）」里手动维护参数",
      };

    default:
      return {
        fields: [],
        noFieldsHint: `平台「${platform}」无 schema 配置，请用「高级（JSON）」编辑`,
      };
  }
}

export type ParsedAdvancedJson =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; msg: string };

export function parseAdvancedJson(raw: string): ParsedAdvancedJson {
  const t = raw.trim();
  if (!t) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch (e) {
    return { ok: false, msg: `高级 JSON 解析失败：${(e as Error).message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, msg: "高级 JSON 必须是对象 {...}，不能是 null / 数组 / 标量" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export type ParsedNumberField =
  | { ok: true; value: number }
  | { ok: false; msg: string };

// 留空（"") → ok: true, value: NaN，由外层用 Number.isFinite 过滤掉、不写入 finalParams
export function validateNumberField(f: ParamField, raw: string): ParsedNumberField {
  if (raw === "") return { ok: true, value: NaN };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, msg: `「${f.label}」必须是数字` };
  if (f.min !== undefined && n < f.min) {
    return { ok: false, msg: `「${f.label}」不能小于 ${f.min}` };
  }
  if (f.max !== undefined && n > f.max) {
    return { ok: false, msg: `「${f.label}」不能大于 ${f.max}` };
  }
  return { ok: true, value: n };
}
