// 5.19up · 智能体知识库（RAG）· KB 专用文本提取
//
// 方案 A 拥有。与聊天附件提取的区别：**不截断**。
// 复用 trial-text-extract 的公共解析能力 parseDocumentText（并行约束方案 A §4.1）；
// 超 D9 字符上限（KB_MAX_DOC_CHARS）→ 返回失败、提示拆分，绝不静默截断后标 done。

import { parseDocumentText } from "../trial-text-extract";
import { KB_MAX_DOC_CHARS } from "./types";

export type KbExtractResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * 知识库文档文本提取。
 * - 解析失败 / 不支持的格式 / 空内容 → ok:false
 * - 文本超 KB_MAX_DOC_CHARS → ok:false（提示拆分），不截断
 * - 否则 ok:true，返回完整文本
 */
export async function extractForKb(
  buffer: Buffer,
  fileName: string,
): Promise<KbExtractResult> {
  let text: string | null;
  try {
    text = await parseDocumentText(buffer, fileName);
  } catch (e) {
    console.error("[kb/extract] parse error:", fileName, e);
    return { ok: false, error: "文档解析失败" };
  }

  if (text === null) {
    return { ok: false, error: "无法解析该文档（格式不支持或内容为空）" };
  }

  if (text.length > KB_MAX_DOC_CHARS) {
    return {
      ok: false,
      error: `文档过大（提取出 ${text.length} 字符，上限 ${KB_MAX_DOC_CHARS}），请拆分后分多次上传`,
    };
  }

  return { ok: true, text };
}
