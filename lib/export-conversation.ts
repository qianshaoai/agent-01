"use client";
// ⚠ CLIENT-ONLY
// 该模块用 Blob / URL / 动态 import docx / fetch 图片，
// 严禁从 server route 或 Server Component 导入。
//
// 5.6up · 对话导出多格式 service
// - markdown：纯字符串拼接，立即生成
// - docx：dynamic import "docx"（webpack/Turbopack 自动分独立 chunk，首屏不加载）
// - 图片：fetch 后嵌入；单图失败降级为 "图片：filename — 链接 url"，不阻塞整体

export type ExportFormat = "markdown" | "docx";

export type ExportProgress = (stage: string) => void;

export type ExportMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  aborted?: boolean;
  attachedFiles?: string[];
  attachedImages?: { filename: string; url: string }[];
};

export type ExportContext = {
  agentName: string;
  agentCode: string;
  conversationTitle: string;
  messages: ExportMessage[];
};

export type ExportResult = {
  blob: Blob;
  filename: string;
  partialFailures: Array<{ filename: string; reason: string }>;
};

// ─── 文件名工具 ─────────────────────────────────────────────────────
function sanitizeFilenamePart(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, "_").trim().slice(0, 60) || "对话";
}

function buildFilename(ctx: ExportContext, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateForName = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${sanitizeFilenamePart(ctx.agentName)}-${sanitizeFilenamePart(
    ctx.conversationTitle
  )}-${dateForName}.${ext}`;
}

function safeTitle(name: string): string {
  return (
    name
      .replace(/[\r\n]+/g, " ")
      .replace(/[#*_`[\]<>]/g, "")
      .trim() || "智能体"
  );
}

function realMessages(messages: ExportMessage[]): ExportMessage[] {
  // 过滤 greeting 虚拟消息（id 以 "greeting-" 开头，不入库）
  return messages.filter((m) => !m.id.startsWith("greeting-"));
}

// ─── Markdown 生成 ─────────────────────────────────────────────────
function buildMarkdown(ctx: ExportContext): string {
  const msgs = realMessages(ctx.messages);
  const lines: string[] = [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  lines.push(`# 与 ${safeTitle(ctx.agentName)} 的对话`);
  lines.push("");
  lines.push(`**导出时间**：${dateStr}`);
  lines.push(`**消息条数**：${msgs.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const m of msgs) {
    const roleLabel = m.role === "user" ? "👤 用户" : "🤖 助手";
    lines.push(`## ${roleLabel}${m.createdAt ? `  ·  ${m.createdAt}` : ""}`);
    lines.push("");

    if (m.attachedImages && m.attachedImages.length > 0) {
      for (const img of m.attachedImages) {
        lines.push(`![${img.filename}](${img.url})`);
      }
      lines.push("");
    }
    if (m.attachedFiles && m.attachedFiles.length > 0) {
      for (const f of m.attachedFiles) {
        lines.push(`📎 附件：${f}`);
      }
      lines.push("");
    }
    if (m.content) {
      lines.push(m.content);
      lines.push("");
    }
    if (m.aborted) {
      lines.push("⚠ 已停止生成");
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(`> 由「人机协同工作舱」生成 · ${ctx.agentCode}`);

  return lines.join("\n");
}

// ─── 图片 fetch（带超时 + 失败降级）─────────────────────────────────
async function fetchImageWithTimeout(
  url: string,
  timeoutMs = 5000
): Promise<{ ok: true; data: ArrayBuffer; mime: string } | { ok: false; reason: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const blob = await res.blob();
    if (blob.size > 10 * 1024 * 1024) return { ok: false, reason: ">10MB" };
    if (!blob.type.startsWith("image/")) return { ok: false, reason: `非图片 (${blob.type})` };
    const data = await blob.arrayBuffer();
    return { ok: true, data, mime: blob.type };
  } catch (e) {
    const reason =
      e instanceof DOMException && e.name === "AbortError"
        ? "超时"
        : e instanceof Error
        ? e.message
        : "未知错误";
    return { ok: false, reason };
  }
}

// ─── DOCX 生成 ─────────────────────────────────────────────────────
async function buildDocxBlob(
  ctx: ExportContext,
  onProgress?: ExportProgress
): Promise<{ blob: Blob; partialFailures: Array<{ filename: string; reason: string }> }> {
  onProgress?.("加载 docx 库…");
  // 顶层禁止 import；动态加载 → 独立 chunk
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    ImageRun,
    HeadingLevel,
    AlignmentType,
  } = docx;

  const msgs = realMessages(ctx.messages);
  const partialFailures: Array<{ filename: string; reason: string }> = [];

  // 先收集所有图片 URL，统计总数后再开始 fetch（用于进度提示）
  const allImages: { filename: string; url: string }[] = [];
  for (const m of msgs) {
    if (m.attachedImages) allImages.push(...m.attachedImages);
  }

  // 先把所有图 fetch 出来缓存，避免拼文档时还在等网络（也方便进度统计）
  const imageCache = new Map<
    string,
    { ok: true; data: ArrayBuffer; mime: string } | { ok: false; reason: string }
  >();
  for (let i = 0; i < allImages.length; i++) {
    onProgress?.(`正在打包 ${i + 1}/${allImages.length} 张图…`);
    const r = await fetchImageWithTimeout(allImages[i].url);
    imageCache.set(allImages[i].url, r);
    if (!r.ok) {
      partialFailures.push({ filename: allImages[i].filename, reason: r.reason });
    }
  }

  onProgress?.("正在生成文档…");

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children: any[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `与 ${safeTitle(ctx.agentName)} 的对话` })],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "导出时间：", bold: true }),
        new TextRun({ text: dateStr }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "消息条数：", bold: true }),
        new TextRun({ text: String(msgs.length) }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: "" })] })
  );

  for (const m of msgs) {
    const roleLabel = m.role === "user" ? "👤 用户" : "🤖 助手";
    const headerText = m.createdAt ? `${roleLabel}  ·  ${m.createdAt}` : roleLabel;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: headerText })],
      })
    );

    // 图片附件
    if (m.attachedImages && m.attachedImages.length > 0) {
      for (const img of m.attachedImages) {
        const cached = imageCache.get(img.url);
        if (cached && cached.ok) {
          try {
            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    // docx@9.x ImageRun 需要传 Uint8Array 而非 ArrayBuffer
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    data: new Uint8Array(cached.data) as any,
                    transformation: { width: 360, height: 240 },
                  } as ConstructorParameters<typeof ImageRun>[0]),
                ],
              })
            );
          } catch (e) {
            // ImageRun 构造失败（解析图片失败）—— 降级
            partialFailures.push({
              filename: img.filename,
              reason: e instanceof Error ? e.message : "图片解析失败",
            });
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `📷 图片：${img.filename}（嵌入失败）— ${img.url}` }),
                ],
              })
            );
          }
        } else {
          // fetch 失败 → 降级文本
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `📷 图片：${img.filename}（嵌入失败：${
                    cached && !cached.ok ? cached.reason : "未知"
                  }）— ${img.url}`,
                }),
              ],
            })
          );
        }
      }
    }

    // 文件附件
    if (m.attachedFiles && m.attachedFiles.length > 0) {
      for (const f of m.attachedFiles) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `📎 附件：${f}` })],
          })
        );
      }
    }

    // 正文：按 \n\n 切段，段内 \n 用 break
    if (m.content) {
      const paragraphs = m.content.split(/\n\n+/);
      for (const p of paragraphs) {
        const inlineLines = p.split("\n");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runs: any[] = [];
        inlineLines.forEach((line, i) => {
          if (i > 0) runs.push(new TextRun({ break: 1 }));
          runs.push(new TextRun({ text: line }));
        });
        children.push(new Paragraph({ children: runs }));
      }
    }

    // 已停止徽章
    if (m.aborted) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "⚠ 已停止生成", italics: true, color: "888888" })],
        })
      );
    }

    // 消息间空行
    children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
  }

  // Footer 署名
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `由「人机协同工作舱」生成 · ${ctx.agentCode}`,
          color: "888888",
          italics: true,
        }),
      ],
    })
  );

  const doc = new Document({
    sections: [{ children }],
  });

  onProgress?.("正在打包 docx…");
  const blob = await Packer.toBlob(doc);
  return { blob, partialFailures };
}

// ─── 对外统一入口 ──────────────────────────────────────────────────
export async function exportConversation(
  format: ExportFormat,
  ctx: ExportContext,
  onProgress?: ExportProgress
): Promise<ExportResult> {
  if (format === "markdown") {
    const content = buildMarkdown(ctx);
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    return {
      blob,
      filename: buildFilename(ctx, "md"),
      partialFailures: [],
    };
  }

  // docx
  const { blob, partialFailures } = await buildDocxBlob(ctx, onProgress);
  return {
    blob,
    filename: buildFilename(ctx, "docx"),
    partialFailures,
  };
}

// ─── 触发浏览器下载 ────────────────────────────────────────────────
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
