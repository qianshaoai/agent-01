// 5.19up · 智能体知识库（RAG）· 文档摄取流程
//
// 方案 A 拥有。文档上传后：下载 → 提取（不截断）→ 切块 → 向量化 → 写 kb_chunks。
// 文档状态机 pending → indexing → done / failed；超 D9 上限直接 failed 提示拆分。
// D6：本期同步摄取（由文档上传 / 重建接口直接 await）。

import { db } from "../db";
import { extractForKb } from "./extract";
import { chunkText } from "./chunk";
import { embedTexts } from "./embed";
import { KB_MAX_CHUNKS_PER_DOC } from "./types";

/** 知识库文档存储桶下的目录前缀 */
export const KB_STORAGE_BUCKET = "uploads";
export const KB_STORAGE_PREFIX = "kb";

/**
 * 摄取一篇文档：把它从 pending / indexing 推进到 done 或 failed。
 * - 幂等：开始前先清掉该文档已有的 kb_chunks（支持「重建索引」重复调用）。
 * - 出错不抛 —— 统一落到文档 status=failed + error_msg，调用方据文档状态展示。
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const { data: doc, error: docErr } = await db
    .from("kb_documents")
    .select("id, kb_id, filename, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) {
    console.error("[kb/ingest] 读取文档失败", documentId, docErr);
    return;
  }

  // 小B finding 2：失败时同步把统计清零，避免页面残留旧的 "已完成 N 个片段"
  const fail = async (msg: string) => {
    await db
      .from("kb_documents")
      .update({
        status: "failed",
        error_msg: msg.slice(0, 500),
        chunk_count: 0,
        char_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  };

  try {
    await db
      .from("kb_documents")
      .update({ status: "indexing", error_msg: "", updated_at: new Date().toISOString() })
      .eq("id", documentId);

    // 重建支持：先清掉旧切片
    // 小B finding 2：清失败必须中断，否则旧 chunk 残留 + 新 chunk 写入 → 重复检索
    const { error: clearErr } = await db
      .from("kb_chunks")
      .delete()
      .eq("document_id", documentId);
    if (clearErr) {
      await fail(`清理旧索引失败：${clearErr.message}`);
      return;
    }

    // 1. 下载文件
    const buffer = await downloadFromStorage(doc.storage_path);
    if (!buffer) {
      await fail("文件下载失败，请重试或重新上传");
      return;
    }

    // 2. 提取文本（不截断；超 D9 字符上限 → 失败提示拆分）
    const extracted = await extractForKb(buffer, doc.filename);
    if (!extracted.ok) {
      await fail(extracted.error);
      return;
    }

    // 3. 切块
    const chunks = chunkText(extracted.text);
    if (chunks.length === 0) {
      await fail("文档无有效文本内容");
      return;
    }
    if (chunks.length > KB_MAX_CHUNKS_PER_DOC) {
      await fail(
        `文档切出 ${chunks.length} 块，超上限 ${KB_MAX_CHUNKS_PER_DOC}，请拆分后分多次上传`,
      );
      return;
    }

    // 4. 向量化（embed.ts 内部按批；失败抛错 → 落 failed）
    const vectors = await embedTexts(chunks.map((c) => c.content));
    if (vectors.length !== chunks.length) {
      await fail("向量化结果数量与切块不符");
      return;
    }

    // 5. 写 kb_chunks（embedding 用 pgvector 文本格式 "[..]"）
    const rows = chunks.map((c, i) => ({
      document_id: documentId,
      kb_id: doc.kb_id,
      chunk_index: c.index,
      content: c.content,
      token_count: c.tokenCount,
      embedding: JSON.stringify(vectors[i]),
    }));
    const { error: insErr } = await db.from("kb_chunks").insert(rows);
    if (insErr) {
      await fail(`写入向量库失败：${insErr.message}`);
      return;
    }

    // 6. 完成
    await db
      .from("kb_documents")
      .update({
        status: "done",
        chunk_count: chunks.length,
        char_count: extracted.text.length,
        error_msg: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kb/ingest] 摄取异常", documentId, e);
    await fail(msg);
  }
}

/** 从 Supabase Storage 下载文件为 Buffer */
async function downloadFromStorage(path: string): Promise<Buffer | null> {
  if (!path) return null;
  try {
    const { data, error } = await db.storage.from(KB_STORAGE_BUCKET).download(path);
    if (error || !data) {
      console.error("[kb/ingest] storage download 失败", path, error);
      return null;
    }
    return Buffer.from(await data.arrayBuffer());
  } catch (e) {
    console.error("[kb/ingest] storage download 异常", path, e);
    return null;
  }
}
