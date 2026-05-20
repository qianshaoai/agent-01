// 5.19up · 知识库 方案B · 对话检索封装
//
// 职责：把「用户问题 → 向量化 → 调 match_kb_chunks RPC → 取 top-K 片段」这条链路
// 收口在一处，不让 RPC 细节散落到 chat route（约束 §六）。
//
// 依赖（方案A 交付，B 只调用）：
//   - lib/kb/embed.ts  · embedQuery() —— 把问题向量化
//   - match_kb_chunks RPC（约束 §3.2 冻结签名）
//   - lib/kb/types.ts  · KbSearchResult
// A 未交付前 embedQuery 是桩、调用即抛错 —— 调用方（chat route）需 try/catch 降级。

import { db } from "@/lib/db";
import { embedQuery } from "@/lib/kb/embed";
import type { KbSearchResult } from "@/lib/kb/types";
// 5.19up 知识库 · 二轮收口：top-K / 阈值改从 A 的统一配置出口（@/lib/kb/config）取，
//   不再在 B 这边硬编码 —— A/B 改默认值只改一处（母方案 D4 推荐值落于 config.ts）。
import { KB_TOP_K, KB_SIMILARITY_THRESHOLD } from "@/lib/kb/config";

/**
 * 跨指定知识库检索与 query 相关的 top-K 片段。
 * @param kbIds  绑定的知识库 id（来自 agent_knowledge_bases，或草稿的 builder_config）
 * @param query  本轮用户问题
 * @returns      命中的片段；无绑定 / 空 query 直接返回 []
 * @throws       embedding 失败或 RPC 报错时抛出 —— 调用方须 try/catch 降级为无知识库回答
 *
 * 备注：disabled 知识库与未启用切片由 v39 的 `match_kb_chunks` RPC 服务端兜底过滤
 * （`knowledge_bases.status='active'`），调用方无需在 kbIds 里再过滤一遍。
 */
export async function retrieveKbChunks(
  kbIds: string[],
  query: string,
): Promise<KbSearchResult[]> {
  const ids = [...new Set(kbIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0 || !query.trim()) return [];

  // 1. 问题向量化（A 的 PR-A2 已交付真实现）
  const queryVec = await embedQuery(query);

  // 2. 调检索 RPC —— 向量距离排序必须走 RPC，不在业务代码里拼 ORDER BY（约束 §3.2）
  const { data, error } = await db.rpc("match_kb_chunks", {
    p_kb_ids: ids,
    p_query: queryVec,
    p_top_k: KB_TOP_K,
    p_threshold: KB_SIMILARITY_THRESHOLD,
  });
  if (error) {
    throw new Error(`match_kb_chunks RPC 失败：${error.message}`);
  }
  const results = (data ?? []) as KbSearchResult[];

  // 临时联调日志 —— 5/20 验收期看清"为什么没命中"；联调结束移除（变更记录有标）
  if (process.env.NODE_ENV !== "production") {
    const sims = results
      .map((r) => r.similarity)
      .filter((s): s is number => typeof s === "number")
      .map((s) => s.toFixed(3));
    console.log(
      `[kb/retrieve] query="${query.slice(0, 40)}" kbIds=${ids.length} top_k=${KB_TOP_K} threshold=${KB_SIMILARITY_THRESHOLD} → hits=${results.length} similarities=[${sims.join(", ")}]`,
    );
  }
  return results;
}
