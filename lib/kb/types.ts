// 5.19up · 智能体知识库（RAG）· 共享类型与常量
//
// 方案 A 创建并拥有；方案 B 只 import、不得修改（见「并行开发统一约束」§3.3）。
// 需要新增字段时，先改并行约束的冻结契约，再由方案 A 改本文件。
// 本文件即方案 A · PR-A1 的正式交付，取代方案 B 联调期的临时桩。
//
// 运行参数统一出口：见 `lib/kb/config.ts`（含 D4 检索参数 + 本文件 D1/D5/D9 的常量
// 再导出）。新增运行参数请加到 config.ts，不要散落到调用处硬编码。

/** 知识库文档的摄取状态机 */
export type KbDocumentStatus = "pending" | "indexing" | "done" | "failed";

/** 知识库 */
export type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  /** 建库时用的 embedding 模型名（全站统一，仅作记录） */
  embedding_model: string;
  status: "active" | "disabled";
  created_at: string;
};

/** 知识库内的一篇文档 */
export type KbDocument = {
  id: string;
  kb_id: string;
  filename: string;
  file_type: string;
  status: KbDocumentStatus;
  /** 切出的片段数 */
  chunk_count: number;
  /** 提取出的纯文本字符数 */
  char_count: number;
  /** status=failed 时的失败原因 */
  error_msg: string;
  created_at: string;
};

/**
 * 检索结果 —— 冻结契约（「并行开发统一约束」§3.3）。
 * 方案 B 通过 lib/kb/retrieve.ts 拿到该类型；不得修改本类型定义。
 */
export type KbSearchResult = {
  content: string;
  document_id: string;
  similarity?: number;
  distance?: number;
};

/** 一个切块（chunkText 的输出 / 入库前的中间结构） */
export type KbChunk = {
  /** 文档内序号，从 0 开始 */
  index: number;
  content: string;
  /** 估算 token 数 */
  tokenCount: number;
};

// ─── 摄取硬上限（D9，「并行开发统一约束」§七.3 冻结）────────────────────────
/** 单文档最大提取文本字符数；超出 → 文档置 failed、提示拆分，不静默截断 */
export const KB_MAX_DOC_CHARS = 200_000;
/** 单文档最大切块数；超出 → 文档置 failed、提示拆分 */
export const KB_MAX_CHUNKS_PER_DOC = 500;
/** 调 embedding 接口时每批的片段数 */
export const KB_EMBED_BATCH_SIZE = 64;

// ─── 切块参数（D5）────────────────────────────────────────────────────────
/** 单块目标 token 数 */
export const KB_CHUNK_TARGET_TOKENS = 500;
/** 相邻块的重叠 token 数 */
export const KB_CHUNK_OVERLAP_TOKENS = 80;

// ─── 向量维度（D1）────────────────────────────────────────────────────────
/** 智谱 embedding 向量维度，与 migration_v38 的 vector(1024) 必须一致 */
export const KB_EMBEDDING_DIM = 1024;
