// 5.19up · 知识库 方案B · 对话检索封装
//
// 职责：把「用户问题 → 向量化 → 调 match_kb_chunks RPC → 取 top-K 片段」这条链路
// 收口在一处，不让 RPC 细节散落到 chat route（约束 §六）。
//
// 6.4up R1.2-3 重构：把"build expanded query"和"对已有 vec 检索"拆开，让 chat
//   route 能在 retrieveKbChunksByVec + rank_kb_context_chunks 之间共享 queryVec
//   （避免对同一 query embed 两次）。test-chat 仍走老 retrieveKbChunks 薄壳。
//
// 6.4up R1.2-4 新增 fetchActiveChunksByIds：按 chunk_id 列表回查正文，严格按
//   入参顺序排序，过滤 active KB + done 文档 + agent kbIds（与 migration_v42
//   match_kb_chunks 同口径）。给 2-B+ 池内 chunks 注入前回查用。
//
// 依赖：
//   - lib/kb/embed.ts  · embedQuery() —— 把问题向量化
//   - match_kb_chunks RPC（约束 §3.2 冻结签名）
//   - lib/kb/types.ts  · KbSearchResult / ChatMessage

import { db } from "@/lib/db";
import { embedQuery } from "@/lib/kb/embed";
import type { KbSearchResult } from "@/lib/kb/types";
import type { ChatMessage } from "@/lib/adapters";
import {
  KB_TOP_K,
  KB_SIMILARITY_THRESHOLD,
  KB_RETRIEVE_HISTORY_TURNS,
  KB_RETRIEVE_QUERY_MAX_CHARS,
} from "@/lib/kb/config";

// ─── R1.2-3 · expanded query 构造（拆出 helper 让 chat route 复用日志）──
function stripAttachmentsAndRefMarker(content: string): string {
  return content
    .replace(/^\[参考：[^\]]+\]\n/, "")     // 5.12up · 前端 chip 标签
    .replace(/\n\n\[附件内容\][\s\S]*$/, ""); // 4.30up · 附件文本段
}

/**
 * 6.4up 1-C · 历史拼接 query 构造
 * 取最近 N 条 user message（去 [参考] 标签 + [附件] 段）+ 当前问题，整体截到
 * 长度上限。避免跨话题 query 失焦同时让"代词 / 模糊指代"型短追问能借历史召回。
 */
export function buildKbExpandedQuery(
  query: string,
  historyMessages?: ChatMessage[],
): string {
  const recentUserTurns = (historyMessages ?? [])
    .filter((m) => m.role === "user")
    .slice(-KB_RETRIEVE_HISTORY_TURNS)
    .map((m) => stripAttachmentsAndRefMarker(m.content));
  return [...recentUserTurns, query.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, KB_RETRIEVE_QUERY_MAX_CHARS);
}

// ─── 检索底层 · 给定 vec 检索 ─────────────────────────────────────────────

/**
 * 6.4up R1.2-3 · 按已有 query 向量检索（chat route 用，复用 queryVec）。
 * @throws RPC 报错时抛出 —— 调用方须 try/catch 降级
 */
export async function retrieveKbChunksByVec(
  kbIds: string[],
  queryVec: number[],
): Promise<KbSearchResult[]> {
  const ids = [...new Set(kbIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0) return [];

  const { data, error } = await db.rpc("match_kb_chunks", {
    p_kb_ids: ids,
    p_query: queryVec,
    p_top_k: KB_TOP_K,
    p_threshold: KB_SIMILARITY_THRESHOLD,
  });
  if (error) {
    throw new Error(`match_kb_chunks RPC 失败：${error.message}`);
  }
  const chunks = (data ?? []) as KbSearchResult[];

  // 5.28up · B · 补 filename（同老 retrieveKbChunks 逻辑）
  if (chunks.length > 0) {
    const docIds = [...new Set(chunks.map((c) => c.document_id).filter(Boolean))];
    if (docIds.length > 0) {
      try {
        const { data: docs } = await db
          .from("kb_documents")
          .select("id, filename")
          .in("id", docIds);
        const nameById = new Map<string, string>(
          (docs ?? []).map((d: { id: string; filename: string }) => [d.id, d.filename]),
        );
        for (const c of chunks) {
          const name = nameById.get(c.document_id);
          if (name) c.filename = name;
        }
      } catch (e) {
        console.warn("[kb/retrieve] 补 filename 失败（不阻断）", e);
      }
    }
  }
  return chunks;
}

// ─── 检索入口 · build + embed + retrieve（test-chat 用薄壳）─────────────

/**
 * 跨指定知识库检索与 query 相关的 top-K 片段。
 * @param kbIds  绑定的知识库 id（来自 agent_knowledge_bases，或草稿的 builder_config）
 * @param query  本轮用户问题
 * @param historyMessages  6.4up 1-C · 可选，传入则做历史拼接
 * @returns      命中的片段；无绑定 / 空 query 直接返回 []
 * @throws       embedding 失败或 RPC 报错时抛出 —— 调用方须 try/catch 降级
 *
 * test-chat / 老调用路径用这个薄壳；chat route 走 buildKbExpandedQuery +
 * embedQuery + retrieveKbChunksByVec 三步以复用 queryVec。
 *
 * 备注：disabled 知识库与未启用切片由 v39/v42 的 match_kb_chunks RPC 服务端
 * 兜底过滤（active KB + done 文档），调用方无需在 kbIds 里再过滤一遍。
 */
export async function retrieveKbChunks(
  kbIds: string[],
  query: string,
  historyMessages?: ChatMessage[],
): Promise<KbSearchResult[]> {
  if (!query.trim()) return [];
  const expanded = buildKbExpandedQuery(query, historyMessages);
  const queryVec = await embedQuery(expanded);
  return retrieveKbChunksByVec(kbIds, queryVec);
}

// ─── 6.4up R1.2-4 · 按 chunk_id 列表回查正文（2-B+ 池注入用）────────────

/**
 * 给定 chunk_ids，回查 kb_chunks 拿正文，过滤 active KB + done 文档 + agentKbIds。
 *
 * R1.2-4 · 严格按入参顺序返回（PG `.in()` 不保序，内部用 Map<id,row> + chunkIds.map 重排）。
 * 被过滤掉的 chunk_id 不返回，结果 length 可能 < chunkIds.length。
 *
 * 用途：2-B+ 注入流程的最后一步，把综合排序后的 top-K chunk_id 转成实际正文。
 */
export async function fetchActiveChunksByIds(
  chunkIds: string[],
  agentKbIds: string[],
): Promise<KbSearchResult[]> {
  if (chunkIds.length === 0 || agentKbIds.length === 0) return [];

  const { data, error } = await db
    .from("kb_chunks")
    .select(`
      id,
      document_id,
      kb_id,
      content,
      knowledge_bases!inner(status),
      kb_documents!inner(status, filename)
    `)
    .in("id", chunkIds)
    .in("kb_id", agentKbIds)
    .eq("knowledge_bases.status", "active")
    .eq("kb_documents.status", "done");

  if (error) {
    console.warn("[kb/fetchActiveChunksByIds] 失败（不阻断）", error.message);
    return [];
  }

  // R1.2-4 · 按入参 chunkIds 顺序重排（`.in()` 不保证顺序）
  type Row = {
    id: string;
    document_id: string;
    kb_id: string;
    content: string;
    kb_documents?: { filename?: string } | null;
  };
  const rowById = new Map<string, Row>(((data ?? []) as Row[]).map((r) => [r.id, r]));
  const ordered: KbSearchResult[] = [];
  for (const id of chunkIds) {
    const r = rowById.get(id);
    if (!r) continue; // 过滤掉的 chunk_id（KB 已停用 / 文档非 done / 解绑）
    ordered.push({
      id: r.id,
      document_id: r.document_id,
      kb_id: r.kb_id,
      content: r.content,
      similarity: 0, // 历史回查不带 similarity；综合排序由 score 决定
      filename: r.kb_documents?.filename,
    } as KbSearchResult);
  }
  return ordered;
}
