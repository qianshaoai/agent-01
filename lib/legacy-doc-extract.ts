import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);

const OLE2_MAGIC = "D0CF11E0A1B11AE1";
const FIB_BASE_FLAGS_OFFSET = 0x0a;
const FIB_FC_MIN_OFFSET = 0x18;
const FIB_FC_MAC_OFFSET = 0x1c;
const FIB_FC_LCB_BASE_OFFSET = 0x94;
const FIB_FC_CLX_PAIR_INDEX = 33;
const FIB_F_WHICH_TBL_STM = 0x0200;
const MAX_PIECES = 20_000;
const MAX_REASONABLE_CHARS = 5_000_000;

type CfbEntry = {
  name?: string;
  content?: Buffer | Uint8Array | number[];
};

type CfbContainer = {
  FullPaths?: string[];
  FileIndex?: CfbEntry[];
};

type PieceCandidate = {
  compressed: boolean;
  offset: number;
  byteLength: number;
};

export async function extractLegacyDocText(
  buffer: Buffer,
  fileName = "document.doc",
): Promise<string | null> {
  if (!isOle2(buffer)) return null;

  const nativeText = extractLegacyDocTextFromCfb(buffer);
  if (nativeText) return nativeText;

  return extractLegacyDocTextWithLibreOffice(buffer, fileName);
}

function extractLegacyDocTextFromCfb(buffer: Buffer): string | null {
  let cfb: CfbContainer;
  try {
    cfb = XLSX.CFB.read(buffer, { type: "buffer" }) as CfbContainer;
  } catch (e) {
    console.warn("[legacy-doc] CFB parse failed:", e instanceof Error ? e.message : e);
    return null;
  }

  const wordDocument = getCfbStream(cfb, "WordDocument");
  if (!wordDocument || wordDocument.length < FIB_FC_MAC_OFFSET + 4) return null;

  const tableNames = preferredTableNames(wordDocument);
  for (const tableName of tableNames) {
    const tableStream = getCfbStream(cfb, tableName);
    if (!tableStream) continue;

    const byFib = extractFromFibClx(wordDocument, tableStream);
    if (byFib) return byFib;

    const byScan = scanPieceTables(wordDocument, tableStream);
    if (byScan) return byScan;
  }

  return extractContinuousText(wordDocument);
}

function preferredTableNames(wordDocument: Buffer): string[] {
  const flags = readU16(wordDocument, FIB_BASE_FLAGS_OFFSET);
  const preferred = (flags & FIB_F_WHICH_TBL_STM) !== 0 ? "1Table" : "0Table";
  const other = preferred === "1Table" ? "0Table" : "1Table";
  return [preferred, other];
}

function extractFromFibClx(wordDocument: Buffer, tableStream: Buffer): string | null {
  const pairOffset = FIB_FC_LCB_BASE_OFFSET + 2 + FIB_FC_CLX_PAIR_INDEX * 8;
  if (wordDocument.length < pairOffset + 8) return null;

  const pairCount = readU16(wordDocument, FIB_FC_LCB_BASE_OFFSET);
  if (pairCount <= FIB_FC_CLX_PAIR_INDEX) return null;

  const fcClx = readU32(wordDocument, pairOffset);
  const lcbClx = readU32(wordDocument, pairOffset + 4);
  if (lcbClx <= 0 || fcClx < 0 || fcClx + lcbClx > tableStream.length) return null;

  return extractFromClx(wordDocument, tableStream.subarray(fcClx, fcClx + lcbClx));
}

function scanPieceTables(wordDocument: Buffer, tableStream: Buffer): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (let offset = 0; offset + 5 < tableStream.length; offset++) {
    if (tableStream[offset] !== 0x02) continue;

    const lcb = readU32(tableStream, offset + 1);
    if (!isPlausiblePlcPcdLength(lcb) || offset + 5 + lcb > tableStream.length) continue;

    const text = extractFromPlcPcd(wordDocument, tableStream.subarray(offset + 5, offset + 5 + lcb));
    const score = scoreText(text);
    if (text && score > bestScore) {
      best = text;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function extractFromClx(wordDocument: Buffer, clx: Buffer): string | null {
  let offset = 0;
  while (offset < clx.length) {
    const tag = clx[offset];
    if (tag === 0x01) {
      if (offset + 3 > clx.length) return null;
      const grpprlLength = readU16(clx, offset + 1);
      offset += 3 + grpprlLength;
      continue;
    }

    if (tag === 0x02) {
      if (offset + 5 > clx.length) return null;
      const lcb = readU32(clx, offset + 1);
      if (!isPlausiblePlcPcdLength(lcb) || offset + 5 + lcb > clx.length) return null;
      return extractFromPlcPcd(wordDocument, clx.subarray(offset + 5, offset + 5 + lcb));
    }

    offset += 1;
  }

  return null;
}

function extractFromPlcPcd(wordDocument: Buffer, plcPcd: Buffer): string | null {
  if (!isPlausiblePlcPcdLength(plcPcd.length)) return null;

  const pieceCount = (plcPcd.length - 4) / 12;
  if (pieceCount <= 0 || pieceCount > MAX_PIECES) return null;

  const cps: number[] = [];
  for (let i = 0; i <= pieceCount; i++) {
    cps.push(readU32(plcPcd, i * 4));
  }
  if (!isValidCpArray(cps)) return null;

  const pcdBase = (pieceCount + 1) * 4;
  const parts: string[] = [];
  for (let i = 0; i < pieceCount; i++) {
    const charCount = cps[i + 1] - cps[i];
    if (charCount <= 0) continue;

    const pcdOffset = pcdBase + i * 8;
    const fcCompressed = readU32(plcPcd, pcdOffset + 2);
    const piece = decodePiece(wordDocument, fcCompressed, charCount);
    if (piece) parts.push(piece);
  }

  return cleanExtractedText(parts.join(""));
}

function decodePiece(wordDocument: Buffer, fcCompressed: number, charCount: number): string | null {
  for (const candidate of pieceCandidates(fcCompressed, charCount)) {
    if (candidate.offset < 0 || candidate.offset + candidate.byteLength > wordDocument.length) continue;

    const raw = wordDocument.subarray(candidate.offset, candidate.offset + candidate.byteLength);
    const text = candidate.compressed ? raw.toString("latin1") : raw.toString("utf16le");
    if (scoreText(text) > 0) return text;
  }
  return null;
}

function pieceCandidates(fcCompressed: number, charCount: number): PieceCandidate[] {
  const compressedBySpec = (fcCompressed & 0x40000000) !== 0;
  const fcBySpec = fcCompressed & 0x3fffffff;
  const lowBitCompressed = (fcCompressed & 0x00000001) !== 0;
  const lowBitFc = (fcCompressed & 0xfffffffe) >>> 0;

  return [
    {
      compressed: compressedBySpec,
      offset: compressedBySpec ? Math.floor(fcBySpec / 2) : fcBySpec,
      byteLength: compressedBySpec ? charCount : charCount * 2,
    },
    {
      compressed: lowBitCompressed,
      offset: lowBitFc,
      byteLength: lowBitCompressed ? charCount : charCount * 2,
    },
    {
      compressed: false,
      offset: fcCompressed,
      byteLength: charCount * 2,
    },
  ];
}

function extractContinuousText(wordDocument: Buffer): string | null {
  const fcMin = readU32(wordDocument, FIB_FC_MIN_OFFSET);
  const fcMac = readU32(wordDocument, FIB_FC_MAC_OFFSET);
  if (fcMin <= 0 || fcMac <= fcMin || fcMac > wordDocument.length) return null;

  const raw = wordDocument.subarray(fcMin, fcMac);
  const utf16 = cleanExtractedText(raw.toString("utf16le"));
  const latin1 = cleanExtractedText(raw.toString("latin1"));
  return scoreText(utf16) >= scoreText(latin1) ? utf16 : latin1;
}

async function extractLegacyDocTextWithLibreOffice(
  buffer: Buffer,
  fileName: string,
): Promise<string | null> {
  const sofficePath = process.env.LIBREOFFICE_PATH || process.env.SOFFICE_PATH || "soffice";
  const workDir = await mkdtemp(path.join(tmpdir(), "doc-extract-"));
  const inputName = sanitizeFileName(fileName.toLowerCase().endsWith(".doc") ? fileName : `${fileName}.doc`);
  const inputPath = path.join(workDir, inputName);

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync(
      sofficePath,
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--nodefault",
        "--convert-to",
        "txt:Text",
        "--outdir",
        workDir,
        inputPath,
      ],
      { timeout: 30_000, windowsHide: true },
    );

    const files = await readdir(workDir);
    const txtFile = files.find((name) => name.toLowerCase().endsWith(".txt"));
    if (!txtFile) return null;

    const text = await readFile(path.join(workDir, txtFile), "utf8");
    return cleanExtractedText(text);
  } catch (e) {
    console.warn("[legacy-doc] LibreOffice fallback failed:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function getCfbStream(cfb: CfbContainer, streamName: string): Buffer | null {
  const finder = XLSX.CFB.find as unknown as (
    container: CfbContainer,
    path: string,
  ) => CfbEntry | null | undefined;

  const direct = finder(cfb, `/${streamName}`) ?? finder(cfb, streamName);
  const directContent = entryToBuffer(direct);
  if (directContent) return directContent;

  const target = streamName.toLowerCase();
  const entries = cfb.FileIndex ?? [];
  for (let i = 0; i < entries.length; i++) {
    const fullPath = cfb.FullPaths?.[i] ?? entries[i].name ?? "";
    const leaf = fullPath.split("/").filter(Boolean).pop()?.toLowerCase();
    if (leaf !== target) continue;

    const content = entryToBuffer(entries[i]);
    if (content) return content;
  }

  return null;
}

function entryToBuffer(entry: CfbEntry | null | undefined): Buffer | null {
  if (!entry?.content) return null;
  return Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
}

function isOle2(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).toString("hex").toUpperCase() === OLE2_MAGIC;
}

function isPlausiblePlcPcdLength(length: number): boolean {
  return length >= 16 && (length - 4) % 12 === 0 && length < MAX_REASONABLE_CHARS;
}

function isValidCpArray(cps: number[]): boolean {
  if (cps.length < 2) return false;
  for (let i = 1; i < cps.length; i++) {
    if (cps[i] < cps[i - 1]) return false;
  }
  return cps[cps.length - 1] > 0 && cps[cps.length - 1] < MAX_REASONABLE_CHARS;
}

function cleanExtractedText(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\u0000/g, "")
    .replace(/\u0007/g, "\t")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0006\u0008-\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return scoreText(cleaned) > 0 ? cleaned : null;
}

function scoreText(text: string | null): number {
  if (!text) return 0;
  const compact = text.replace(/\s/g, "");
  if (!compact) return 0;
  const printable = compact.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return printable.length >= 2 ? printable.length : 0;
}

function sanitizeFileName(fileName: string): string {
  const safe = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return safe || "upload.doc";
}

function readU16(buffer: Buffer, offset: number): number {
  return offset + 2 <= buffer.length ? buffer.readUInt16LE(offset) : 0;
}

function readU32(buffer: Buffer, offset: number): number {
  return offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : 0;
}
