// 4.30up 体验版 · 通用文档文本提取
//
// 当智能体平台 capabilities.nativeDocuments === false 时，
// 由 portal 后端拉文件 + 提取文本 + 塞进消息正文，让 AI 至少能"读到"内容。
//
// 支持类型：pdf / docx / doc / txt / md / csv / xlsx / xls / pptx

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

/** 提取后的文本截断上限（字符数） */
const TEXT_MAX_CHARS = 30_000;

export type ExtractResult = {
  text: string;
  truncated: boolean;
};

/** 把 buffer 按文件扩展名解析成纯文本，失败返回 null */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<ExtractResult | null> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  let raw: string | null = null;

  try {
    if (ext === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      raw = result.text ?? "";
    } else if (ext === "docx" || ext === "doc") {
      // mammoth 主要支持 .docx；.doc（旧二进制格式）多数情况会失败但试一次
      const result = await mammoth.extractRawText({ buffer });
      raw = result.value ?? "";
    } else if (ext === "txt" || ext === "md") {
      raw = decodeText(buffer);
    } else if (ext === "csv") {
      raw = decodeText(buffer);
    } else if (ext === "xlsx" || ext === "xls") {
      raw = extractXlsx(buffer);
    } else if (ext === "pptx") {
      raw = await extractPptx(buffer);
    } else {
      return null; // 不支持的类型
    }
  } catch (e) {
    console.error("[trial-text-extract] failed:", ext, e);
    return null;
  }

  if (!raw) return null;

  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length === 0) return null;

  if (cleaned.length > TEXT_MAX_CHARS) {
    return {
      text: cleaned.slice(0, TEXT_MAX_CHARS),
      truncated: true,
    };
  }

  return { text: cleaned, truncated: false };
}

/** 处理常见编码：UTF-8 BOM / UTF-16 BOM / 默认 UTF-8 / 回退 GBK */
function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf-8");
  }
  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff)
  ) {
    // UTF-16 BE/LE — Node 没原生 UTF-16BE 解码，简单当 utf16le 处理
    return buffer.subarray(2).toString("utf16le");
  }
  // 默认按 UTF-8 试，含乱码则交给 GBK
  const utf8 = buffer.toString("utf-8");
  // 简单启发式：含 U+FFFD 替换符多 → 大概率不是 UTF-8
  if ((utf8.match(/�/g) ?? []).length > 5) {
    try {
      // Node 内置不支持 GBK，但许多中文 Windows 文件是 GBK；这里只做 latin1 兜底
      return buffer.toString("latin1");
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** xlsx/xls → 把每个 sheet 转成 "## SheetName" + CSV 文本块 */
function extractXlsx(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      blocks.push(`## ${name}\n${csv}`);
    }
  }
  return blocks.join("\n\n");
}

/** pptx → 解压取每张 slide 的 a:t 文字 */
async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      return na - nb;
    });

  const blocks: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await zip.files[slidePaths[i]].async("string");
    // 抽 <a:t>...</a:t> 内容；再把 <a:p>（段落）当换行
    const paragraphs = xml.split(/<a:p[\s>]/i).slice(1);
    const lines: string[] = [];
    for (const p of paragraphs) {
      const texts = [...p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) =>
        decodeXmlEntities(m[1])
      );
      const line = texts.join("").trim();
      if (line) lines.push(line);
    }
    if (lines.length > 0) {
      blocks.push(`## 第 ${i + 1} 页\n${lines.join("\n")}`);
    }
  }
  return blocks.join("\n\n");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 拉远端 URL → 提取文本。失败返回 null */
export async function extractTextFromUrl(
  url: string,
  fileName: string
): Promise<ExtractResult | null> {
  console.log(`[trial-text-extract] start: ${fileName} (${url.slice(0, 80)})`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[trial-text-extract] fetch failed:", url, res.status);
      return null;
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    console.log(`[trial-text-extract] fetched ${buffer.length} bytes`);
    const result = await extractTextFromBuffer(buffer, fileName);
    if (!result) {
      console.warn(`[trial-text-extract] extract returned null: ${fileName}`);
    } else {
      console.log(
        `[trial-text-extract] extracted ${result.text.length} chars (truncated=${result.truncated}) from ${fileName}`
      );
    }
    return result;
  } catch (e) {
    console.error("[trial-text-extract] fetchAndExtract error:", e);
    return null;
  }
}
