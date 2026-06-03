// 6.4up R1.1 + R1.2 · 2-B+ 大记忆池 / 小注入窗口 · KB 注入主流程
//
// 职责：把 chat route 的 KB 链路收口在这里，调用方只关心传 args / 拿结果。
// 内部完成：
//   1. build expanded query（历史拼接，1-C）
//   2. embed query → 共享 queryVec
//   3. RPC match_kb_chunks → 本轮 RPC 命中（current chunks）
//   4. SELECT kb_context_state → 拉本会话记忆池
//   5. RPC rank_kb_context_chunks → 池内 chunks 用本轮 queryVec 重算 cosine（R1.2-2）
//   6. 综合分排序 → top K_inject（按模型档位）
//   7. fetchActiveChunksByIds → 取正文 + 过滤 active KB + done 文档
//   8. RPC bump_kb_context_state → upsert 池（hit_count++、is_current 控 last_similarity）
//   9. RPC trim_kb_context_state → 容量裁剪
//
// 关键风险兜底：
//   - 旧话题干扰 · is_current=2.0 + similarity=1.5 主导排序
//   - 旧 chunk content 复活 · fetchActiveChunksByIds 注入前回查 + 同 v42 过滤口径
//   - token 爆炸 · K_inject 按模型档位封顶（默认 12，最大 16）
//   - undefined 序列化 · upsert rows 传 is_current bool 明示参数

import { db } from "@/lib/db";
import { embedQuery } from "@/lib/kb/embed";
import {
  buildKbExpandedQuery,
  fetchActiveChunksByIds,
  retrieveKbChunksByVec,
} from "@/lib/kb/retrieve";
import type { KbSearchResult } from "@/lib/kb/types";
import type { ChatMessage } from "@/lib/adapters";
import {
  KB_INJECT_K_BY_MODEL_TIER,
  KB_INJECT_SCORE_WEIGHTS,
  KB_MEMORY_POOL_SIZE,
  KB_MEMORY_RECALL_MIN_SIMILARITY,
} from "@/lib/kb/config";

// ─── R1.3-2 · 归一化类型 + helper ────────────────────────────────────────
// KbSearchResult.id / similarity 是 optional（向后兼容旧调用），但 2-B+ 记忆池
// 必须有 id 才能上池，必须有 similarity 才能进综合排序。归一化后 Set/Map/RPC
// 写入都拿到非 undefined 字段，避免 string|undefined 类型噪声 + 运行时空字段。
type KbChunkWithId = KbSearchResult & {
  id: string;
  similarity: number;
};

function normalizeKbChunksForMemory(chunks: KbSearchResult[]): KbChunkWithId[] {
  return chunks
    .filter((c): c is KbSearchResult & { id: string } =>
      typeof c.id === "string" && c.id.length > 0,
    )
    .map((c) => ({
      ...c,
      similarity: typeof c.similarity === "number" ? c.similarity : 0,
    }));
}

// ─── 模型档位判定（R1.1-D）───────────────────────────────────────────────
// 用 model 名匹配档位，比按 platform 粗暴判断更准（openai 平台跨度极大：
//   gpt-4o vs gpt-4o-mini 不该用同一个 K_inject）。
const LARGE_TIER_RE = /^(claude-opus|claude-sonnet-4|gpt-4o(?!-mini)|glm-4-plus|claude-3-opus|gemini-1\.5-pro)/i;
const COMPACT_TIER_RE = /^(gpt-3\.5|glm-4-flash|claude-haiku-3|gemini-1\.0)/i;

export function pickInjectK(model: string | undefined): number {
  const m = (model ?? "").trim();
  if (LARGE_TIER_RE.test(m)) return KB_INJECT_K_BY_MODEL_TIER.large;
  if (COMPACT_TIER_RE.test(m)) return KB_INJECT_K_BY_MODEL_TIER.compact;
  return KB_INJECT_K_BY_MODEL_TIER.default;
}

// ─── 综合分排序（R1.1-E）────────────────────────────────────────────────

type Candidate = {
  chunk_id: string;
  is_current: boolean;
  similarity: number;     // 0..1（current 用 RPC 真分；historical 用 rank RPC 重算分）
  hit_count: number;
  last_hit_at: Date;
};

function scoreCandidate(c: Candidate, now: Date): number {
  const w = KB_INJECT_SCORE_WEIGHTS;
  const ageMin = Math.max(0, (now.getTime() - c.last_hit_at.getTime()) / 60_000);
  const recency = Math.exp(-ageMin / 60); // 1h 后衰减到 0.37
  const hitNorm = Math.log(c.hit_count + 1) / Math.log(11); // hit=10 时 ≈ 1
  return (
    (c.is_current ? 1 : 0) * w.is_current +
    c.similarity * w.similarity +
    hitNorm * w.hit_count +
    recency * w.recency
  );
}

// ─── DB 行类型 ──────────────────────────────────────────────────────────

type PoolRow = {
  chunk_id: string;
  first_seen_at: string;
  last_hit_at: string;
  hit_count: number;
  last_similarity: number;
};

type RankRow = { id: string; current_similarity: number };

// ─── 主流程 ─────────────────────────────────────────────────────────────

export type InjectKbForTurnArgs = {
  conversationId: string;
  agentKbIds: string[];
  query: string;
  history: ChatMessage[];
  model: string | undefined;
};

export type InjectKbForTurnResult = {
  /** 真正注入给 prompt 的 chunks（K_inject 个，含正文 + 综合分排序时的 similarity）*/
  injectedChunks: KbChunkWithId[];
  /** 本轮 RPC 命中的 chunks（用于日志/调试）*/
  currentChunks: KbChunkWithId[];
  /** 写回 + 裁剪后池大小（日志用）*/
  poolSize: number;
  /** 实际送 embed 的 query 文本（日志用）*/
  expandedQuery: string;
};

/**
 * 6.4up 2-B+ · 一轮 KB 注入完整流程。
 *
 * 调用方（chat/route.ts）只需传 args，自己拿 injectedChunks 拼 user prefix。
 * test-chat 不走这个函数，自己走简化路径（不接 DB 记忆池）。
 */
export async function injectKbForTurn(
  args: InjectKbForTurnArgs,
): Promise<InjectKbForTurnResult> {
  const { conversationId, agentKbIds, query, history, model } = args;

  // ── 1+2. build expanded query + embed（queryVec 后面 RPC 共享）
  const expandedQuery = buildKbExpandedQuery(query, history);
  const queryVec = await embedQuery(expandedQuery);

  // ── 3. 本轮 RPC 命中（R1.3-2 归一化：丢掉无 id 的异常 chunk，similarity 兜 0）
  const rawCurrentChunks = await retrieveKbChunksByVec(agentKbIds, queryVec);
  const currentChunks = normalizeKbChunksForMemory(rawCurrentChunks);
  const currentIds = new Set<string>(currentChunks.map((c) => c.id));

  // ── 4. 拉本会话记忆池
  const { data: poolRowsData, error: poolErr } = await db
    .from("kb_context_state")
    .select("chunk_id, first_seen_at, last_hit_at, hit_count, last_similarity")
    .eq("conversation_id", conversationId)
    .order("last_hit_at", { ascending: false });
  if (poolErr) {
    console.warn("[kb/inject] 拉记忆池失败（降级为仅本轮 chunks）", poolErr.message);
  }
  const poolRows = (poolRowsData ?? []) as PoolRow[];
  const poolById = new Map<string, PoolRow>(poolRows.map((r) => [r.chunk_id, r]));

  // ── 5. 池内重排（R1.2-2）：池里"不在本轮命中"的 chunks 用 queryVec 重算 cosine
  // R1.3-1 · 加最低相似度门槛 KB_MEMORY_RECALL_MIN_SIMILARITY：池内 chunks 即使
  // hit_count / recency 很高，也必须与本轮 query 有最低相关度才能复活。
  // 否则纯靠"以前聊过"就把旧话题塞回 prompt，会污染回答（尤其当本轮 currentChunks=[]）。
  const poolOnlyIds = poolRows.map((r) => r.chunk_id).filter((id) => !currentIds.has(id));
  let poolRanked: RankRow[] = [];
  if (poolOnlyIds.length > 0) {
    const { data: rankData, error: rankErr } = await db.rpc("rank_kb_context_chunks", {
      p_chunk_ids: poolOnlyIds,
      p_query: queryVec,
      p_kb_ids: agentKbIds,
    });
    if (rankErr) {
      console.warn("[kb/inject] rank_kb_context_chunks 失败（降级为仅本轮）", rankErr.message);
    } else {
      poolRanked = ((rankData ?? []) as RankRow[])
        .filter((r) => r.current_similarity >= KB_MEMORY_RECALL_MIN_SIMILARITY);
    }
  }

  // ── 6. 构造候选 + 综合分排序 → top K_inject
  // R1.3-2 · currentChunks 已 normalize（id/similarity 必填），无需再防御 narrow
  const now = new Date();
  const candidates: Candidate[] = [];

  for (const c of currentChunks) {
    const meta = poolById.get(c.id);
    candidates.push({
      chunk_id: c.id,
      is_current: true,
      similarity: c.similarity,
      hit_count: meta ? meta.hit_count + 1 : 1,
      last_hit_at: now,
    });
  }
  for (const r of poolRanked) {
    const meta = poolById.get(r.id);
    if (!meta) continue; // 理论不会发生（poolOnlyIds 都从 poolRows 来）
    candidates.push({
      chunk_id: r.id,
      is_current: false,
      similarity: r.current_similarity,
      hit_count: meta.hit_count,
      last_hit_at: new Date(meta.last_hit_at),
    });
  }

  const k = pickInjectK(model);
  candidates.sort((a, b) => scoreCandidate(b, now) - scoreCandidate(a, now));
  const selected = candidates.slice(0, k);
  const selectedIds = selected.map((c) => c.chunk_id);
  // 0% bug fix · 把综合排序时算出的 similarity（current 用本轮 RPC 真分；
  // pool 用 rank RPC 重算分）记成 Map，回查正文后回填到 injectedChunks。
  // fetchActiveChunksByIds 只取正文，similarity 硬塞 0，不回填则 messages.references
  // 落库的 similarity 全是 0，前端引用率显示就全是 0%。
  const simById = new Map<string, number>(selected.map((c) => [c.chunk_id, c.similarity]));

  // ── 7. 回查正文（active KB + done 文档 + agentKbIds 过滤；按 selectedIds 顺序）
  const fetched = await fetchActiveChunksByIds(selectedIds, agentKbIds);
  const injectedChunks: KbChunkWithId[] = fetched
    .filter((c): c is KbSearchResult & { id: string } =>
      typeof c.id === "string" && c.id.length > 0,
    )
    .map((c) => ({ ...c, similarity: simById.get(c.id) ?? 0 }));

  // ── 8. upsert 池（R1.2-5：is_current bool 明示参数）
  if (injectedChunks.length > 0) {
    const nowIso = now.toISOString();
    const upsertRows = injectedChunks.map((c) => {
      const isCurrent = currentIds.has(c.id);
      return {
        conversation_id: conversationId,
        chunk_id: c.id,
        last_hit_at: nowIso,
        is_current: isCurrent,
        new_similarity: isCurrent ? c.similarity : null,
      };
    });
    const { error: bumpErr } = await db.rpc("bump_kb_context_state", { p_rows: upsertRows });
    if (bumpErr) {
      console.warn("[kb/inject] bump_kb_context_state 失败（池未更新）", bumpErr.message);
    }
  }

  // ── 9. 池容量裁剪
  const { error: trimErr } = await db.rpc("trim_kb_context_state", {
    p_conversation_id: conversationId,
    p_max_size: KB_MEMORY_POOL_SIZE,
  });
  if (trimErr) {
    console.warn("[kb/inject] trim_kb_context_state 失败（池可能超容）", trimErr.message);
  }

  // ── 10. 取裁剪后池大小（日志用）
  const { count } = await db
    .from("kb_context_state")
    .select("chunk_id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  return {
    injectedChunks,
    currentChunks,
    poolSize: count ?? 0,
    expandedQuery,
  };
}
