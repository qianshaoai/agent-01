// 5.19up 知识库 · 运行参数统一出口
//
// 方案 A / B 双方都从本文件 import 知识库运行参数；改默认值就改这里一处。
// 默认值来源（D 编号）对应母方案 §七 决策点。
// 凡是「改数字会影响 A 和 B 行为」的常量，都集中在这里。

// ─── 切块（D5）+ 摄取硬上限（D9）+ 向量维度（D1）─────────────────────────
// 这几项的实际定义在 ./types（PR-A1 落入），此处只是统一对外出口
export {
  KB_CHUNK_TARGET_TOKENS, //  D5：单块目标 token 数（默认 500）
  KB_CHUNK_OVERLAP_TOKENS, // D5：相邻块重叠 token 数（默认 80）
  KB_EMBEDDING_DIM, //        D1：智谱 embedding，vector(1024)，与 migration_v38 一致
  KB_MAX_DOC_CHARS, //        D9：单文档最大提取字符数（默认 20 万，超出 → failed 提示拆分）
  KB_MAX_CHUNKS_PER_DOC, //   D9：单文档最大切块数（默认 500，超出 → failed 提示拆分）
  KB_EMBED_BATCH_SIZE, //     D9：单次 embedding 调用批量（默认 64）
} from "./types";

// ─── 检索参数（D4）──────────────────────────────────────────────────────
// 母方案 D4 推荐值；本期写为常量，后续要做"管理员可调"再迁到 settings / DB。
// 方案 B 的 lib/kb/retrieve.ts 应从这里 import，不要在调用处硬编码数字。

/** 检索取 top-K（默认 5）—— 调高 = 召回更多但噪声变大、prompt 变长 */
export const KB_TOP_K = 5;

/**
 * 相似度阈值（余弦相似度）—— 低于此值的片段丢弃，防噪声。
 * 6.4up R1.1-1A · 0.5 → 0.35：原 0.5 把「我第一次轮值是啥时候」这类自然语言
 *   query 卡掉（实测语义距离 ~0.4）。降到 0.35 让客户化措辞也能命中。
 */
export const KB_SIMILARITY_THRESHOLD = 0.35;

// ─── 6.4up R1.2 · 会话级记忆池（2-B+ 大池 + 小窗）─────────────────────────
// migration_v45 落地的 kb_context_state 表 + 3 RPC 配套使用。
// 设计：大池保存 chunk_id 元数据；每轮按综合分选 K_inject 个真正注入 prompt。

/** 记忆池容量上限（默认 64，可调到 100）—— 池超容量时按 last_hit_at asc 删旧 */
export const KB_MEMORY_POOL_SIZE = 64;

/**
 * 每轮注入窗口大小 · 按模型档位
 * - large · Opus 4.x / GPT-4o / Sonnet 4.x / glm-4-plus 等 ≥ 64k 上下文
 * - default · 主流中档（gpt-4o-mini / haiku-4.5 / glm-4-air 等）
 * - compact · 紧凑模型（gpt-3.5-turbo / glm-4-flash 等）
 */
export const KB_INJECT_K_BY_MODEL_TIER = {
  large: 16,
  default: 12,
  compact: 8,
} as const;

/**
 * 注入排序综合分权重
 *   score = α·is_current + β·similarity + γ·hit_norm + δ·recency
 * - is_current=2.0 · 本轮 RPC 命中加分（最重要，保证本轮相关 chunks 不被旧池挤掉）
 * - similarity=1.5 · 与本轮 query 的相似度（current chunks 用 RPC 真分；历史用 rank RPC 重算）
 * - hit_count=0.3 · log 归一的累计命中（防 hot chunks 霸榜）
 * - recency=0.5 · 1h e-decay 时间衰减（最近活跃加分）
 */
export const KB_INJECT_SCORE_WEIGHTS = {
  is_current: 2.0,
  similarity: 1.5,
  hit_count: 0.3,
  recency: 0.5,
} as const;

/** 1-C 历史拼接：最近 N 条 user message 拼进 query embedding（默认 2，不建议超 3）*/
export const KB_RETRIEVE_HISTORY_TURNS = 2;

/** 1-C 历史拼接 query 整体长度上限（字符数）—— 防止跨话题 query 失焦 */
export const KB_RETRIEVE_QUERY_MAX_CHARS = 800;
