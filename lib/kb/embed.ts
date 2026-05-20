// 5.19up · 智能体知识库（RAG）· embedding 适配器
//
// 方案 A 拥有；方案 B 通过本文件把用户问题向量化（见「并行开发统一约束」§3.4）。
// 导出签名为冻结契约，不得擅改：
//   embedTexts(texts: string[]): Promise<number[][]>
//   embedQuery(text: string): Promise<number[]>
//
// D1-2：embedding 配置不走 env，从「API 管理」取（model_providers 表 category='embedding'）。
// D1：智谱 embedding，向量维度固定 1024（与 migration_v38 的 vector(1024) 一致）。

import { db } from "../db";
import { decrypt } from "../crypto";
import { KB_EMBED_BATCH_SIZE, KB_EMBEDDING_DIM } from "./types";

type EmbeddingProvider = {
  endpoint: string;
  apiKey: string;
  model: string;
  params: Record<string, unknown>;
};

/** 从「API 管理」取启用中的 embedding provider（category='embedding'）。无 / 不完整即抛错。 */
async function loadEmbeddingProvider(): Promise<EmbeddingProvider> {
  const { data, error } = await db
    .from("model_providers")
    .select("api_endpoint, api_key_enc, default_model, default_params")
    .eq("category", "embedding")
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[kb/embed] 读取 embedding 配置失败：${error.message}`);
  }
  if (!data) {
    throw new Error(
      "[kb/embed] 未配置可用的 embedding 服务 —— 请在「API 管理」新增并启用一个 embedding 类目的配置",
    );
  }

  const endpoint = (data.api_endpoint ?? "").trim();
  const model = (data.default_model ?? "").trim();
  if (!endpoint || !data.api_key_enc) {
    throw new Error("[kb/embed] embedding 配置不完整（缺接口地址或密钥）");
  }

  let apiKey = "";
  try {
    apiKey = decrypt(data.api_key_enc);
  } catch {
    throw new Error("[kb/embed] embedding 密钥解密失败，请在「API 管理」重新保存");
  }
  if (!apiKey) throw new Error("[kb/embed] embedding 密钥为空");

  return {
    endpoint,
    apiKey,
    model: model || "embedding-3",
    params:
      data.default_params && typeof data.default_params === "object"
        ? (data.default_params as Record<string, unknown>)
        : {},
  };
}

/** 调一次智谱 embedding 接口（单批）。只对 fetch 抛错（跨境网络抖动）重试，业务错误直接抛。 */
async function embedBatch(
  provider: EmbeddingProvider,
  batch: string[],
): Promise<number[][]> {
  const body = JSON.stringify({
    ...provider.params,
    model: provider.model,
    input: batch,
    dimensions: KB_EMBEDDING_DIM,
  });

  let res: Response | null = null;
  let netErr: unknown = null;
  for (let attempt = 0; attempt < 3 && res === null; attempt++) {
    try {
      res = await fetch(provider.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body,
      });
    } catch (e) {
      netErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }

  if (res === null) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    throw new Error(`[kb/embed] 连接 embedding 接口失败：${msg}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `[kb/embed] embedding 接口返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ""}`,
    );
  }

  const json = (await res.json()) as {
    data?: { embedding: number[]; index: number }[];
  };
  const items = json.data ?? [];
  if (items.length !== batch.length) {
    throw new Error(
      `[kb/embed] embedding 返回数量不符（期望 ${batch.length}，实际 ${items.length}）`,
    );
  }

  // 按 index 还原顺序，并校验维度（防把错维度向量写进 vector(1024) 列）
  return [...items]
    .sort((a, b) => a.index - b.index)
    .map((it) => {
      if (!Array.isArray(it.embedding) || it.embedding.length !== KB_EMBEDDING_DIM) {
        throw new Error(
          `[kb/embed] embedding 维度不符（期望 ${KB_EMBEDDING_DIM}，实际 ${
            it.embedding?.length ?? "未知"
          }）—— 检查「API 管理」里 embedding 模型 / dimensions 配置`,
        );
      }
      return it.embedding;
    });
}

/** 把多段文本向量化（内部按 KB_EMBED_BATCH_SIZE 分批）。 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = await loadEmbeddingProvider();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += KB_EMBED_BATCH_SIZE) {
    const vecs = await embedBatch(provider, texts.slice(i, i + KB_EMBED_BATCH_SIZE));
    out.push(...vecs);
  }
  return out;
}

/** 把单条查询文本向量化（方案 B 检索用）。 */
export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error("[kb/embed] 查询向量化失败：embedding 返回空");
  return vec;
}
