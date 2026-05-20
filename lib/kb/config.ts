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

/** 相似度阈值（余弦相似度，默认 0.5）—— 低于此值的片段丢弃，防噪声 */
export const KB_SIMILARITY_THRESHOLD = 0.5;
