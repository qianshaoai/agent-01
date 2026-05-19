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

// D4（母方案 §七）：top-K = 5；相似度阈值先给保守默认值，上线后按实际命中效果调
// （母方案 §八：切块大小 / top-K / 阈值留可调，别一次写死）。
export const KB_TOP_K = 5;
// ⚠ 阈值语义（similarity / distance）取决于 A 的 match_kb_chunks 实现，
//   联合联调时按真实命中效果校准；此处给一个偏宽松的默认，避免误杀全部片段。
export const KB_MATCH_THRESHOLD = 0.2;

/**
 * 跨指定知识库检索与 query 相关的 top-K 片段。
 * @param kbIds  绑定的知识库 id（来自 agent_knowledge_bases）
 * @param query  本轮用户问题
 * @returns      命中的片段；无绑定 / 空 query 直接返回 []
 * @throws       embedding 失败或 RPC 报错时抛出 —— 调用方须 try/catch 降级为无知识库回答
 */
export async function retrieveKbChunks(
  kbIds: string[],
  query: string,
): Promise<KbSearchResult[]> {
  const ids = [...new Set(kbIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0 || !query.trim()) return [];

  // 1. 问题向量化（A 未交付前为桩、抛错）
  const queryVec = await embedQuery(query);

  // 2. 调检索 RPC —— 向量距离排序必须走 RPC，不在业务代码里拼 ORDER BY（约束 §3.2）
  const { data, error } = await db.rpc("match_kb_chunks", {
    p_kb_ids: ids,
    p_query: queryVec,
    p_top_k: KB_TOP_K,
    p_threshold: KB_MATCH_THRESHOLD,
  });
  if (error) {
    throw new Error(`match_kb_chunks RPC 失败：${error.message}`);
  }
  return (data ?? []) as KbSearchResult[];
}
