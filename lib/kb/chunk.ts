// 5.19up · 智能体知识库（RAG）· 文档切块
//
// 把文档纯文本切成带重叠的块，供 embedding + 入库用。
// 方案 A 拥有；策略对应母方案 D5（~500 token/块 + ~80 重叠，段落 / 句子边界优先）。

import {
  KB_CHUNK_TARGET_TOKENS,
  KB_CHUNK_OVERLAP_TOKENS,
  type KbChunk,
} from "./types";

/**
 * 粗略估算 token 数。项目未引入分词器，按字符类型近似：
 * CJK 表意字 / 假名 / 谚文约 1 token/字；其它（英文、空白、标点）约 1 token/4 字符。
 * 仅用于切块大小控制，不要求精确。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) || // CJK 部首 / 扩展A / 统一表意
      (code >= 0xac00 && code <= 0xd7ff) || // 谚文
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
      (code >= 0x20000 && code <= 0x3ffff) // CJK 扩展 B+
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk + other / 4);
}

/** 按字符把超长文本硬拆成不超过目标 token 的片段（CJK 最坏 1:1，故按目标 token 数当字符上限）*/
function hardSplit(text: string): string[] {
  const maxChars = Math.max(1, KB_CHUNK_TARGET_TOKENS);
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    pieces.push(text.slice(i, i + maxChars));
  }
  return pieces;
}

/**
 * 把文本拆成「单元」：段落优先；过长段落按句末标点再拆；过长句子按字符硬拆。
 * 保证每个返回单元的估算 token 数 <= KB_CHUNK_TARGET_TOKENS。
 */
function splitUnits(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const units: string[] = [];
  for (const para of paragraphs) {
    if (estimateTokens(para) <= KB_CHUNK_TARGET_TOKENS) {
      units.push(para);
      continue;
    }
    // 过长段落 → 按句末标点切句（标点保留在句尾）
    const sentences = para
      .split(/(?<=[。！？!?；;\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const sentence of sentences) {
      if (estimateTokens(sentence) <= KB_CHUNK_TARGET_TOKENS) {
        units.push(sentence);
      } else {
        units.push(...hardSplit(sentence));
      }
    }
  }
  return units;
}

/**
 * 把文档纯文本切成带重叠的块：
 * - 每块目标 ~KB_CHUNK_TARGET_TOKENS token；
 * - 相邻块重叠 ~KB_CHUNK_OVERLAP_TOKENS token（从上一块尾部回取若干单元）；
 * - 尽量在段落 / 句子边界断开。
 * 返回的 chunk.index 从 0 连续递增。
 */
export function chunkText(text: string): KbChunk[] {
  const units = splitUnits(text);
  const chunks: KbChunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.join("\n");
    chunks.push({
      index: chunks.length,
      content,
      tokenCount: estimateTokens(content),
    });
  };

  for (const unit of units) {
    const unitTokens = estimateTokens(unit);
    if (currentTokens > 0 && currentTokens + unitTokens > KB_CHUNK_TARGET_TOKENS) {
      flush();
      // 重叠：从上一块尾部回取若干单元作为新块开头
      const overlap: string[] = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const u = current[i];
        const t = estimateTokens(u);
        if (overlap.length > 0 && overlapTokens + t > KB_CHUNK_OVERLAP_TOKENS) break;
        overlap.unshift(u);
        overlapTokens += t;
      }
      current = overlap;
      currentTokens = overlapTokens;
    }
    current.push(unit);
    currentTokens += unitTokens;
  }
  flush();
  return chunks;
}
