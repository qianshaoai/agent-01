import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALG = "aes-256-gcm";
const AES_KEY_BYTES = 32;

// 5.14up Fix 3 · 加密 key 与 JWT_SECRET 拆分
// ──────────────────────────────────────────────────────────────────
// 路径 A · Fallback Chain，无 DB rekey：
// - encrypt() 永远用 ENCRYPTION_KEY（新 key）
// - decrypt() 先尝试 ENCRYPTION_KEY，失败回退到 JWT_SECRET（旧 key），都失败抛错
//
// ENCRYPTION_KEY 必须是 base64 编码的 32 字节（256-bit）。
// 严禁再 sha256(ENCRYPTION_KEY)，否则跟"高熵随机"的语义冲突。
//
// 历史脏数据兼容：早期某些字段可能存的是无密文格式的"明文" → decrypt() 收到
// 三段格式不对时，保留原样返回 + dev 环境 warn。
//
// dev 友好：未配置 ENCRYPTION_KEY 时 fallback 到 JWT_SECRET 派生 + console.warn；
// production 不允许这种 fallback，进程启动期直接抛错。

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * 新 key（ENCRYPTION_KEY）。
 * - prod：必须配置且合法（base64 decode 后正好 32 bytes）；否则抛错
 * - dev/test：未配置时 fallback 到 JWT_SECRET 派生 + console.warn
 */
function getNewKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw && raw.length > 0) {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(raw, "base64");
    } catch {
      throw new Error("ENCRYPTION_KEY is not valid base64");
    }
    if (decoded.length !== AES_KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY must decode to ${AES_KEY_BYTES} bytes (got ${decoded.length}); ` +
          `generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    return decoded;
  }

  if (isProduction()) {
    throw new Error("ENCRYPTION_KEY is required in production (must be base64 of 32 bytes)");
  }

  // dev/test fallback：用 JWT_SECRET 派生，等同于 Fix 3 之前的行为
  if (process.env.NODE_ENV !== "test") {
    console.warn(
      "[crypto] ENCRYPTION_KEY not set in non-production env, falling back to JWT_SECRET-derived key. " +
        "Add ENCRYPTION_KEY to .env.local to test the real Fix 3 path.",
    );
  }
  return getOldKey();
}

/**
 * 旧 key（JWT_SECRET 派生）。
 * 永远用于解密历史密文，不用于加密新数据。
 */
function getOldKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

function decryptWith(key: Buffer, parts: string[]): string {
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** AES-256-GCM 加密，输出 "iv:authTag:ciphertext"（均为 hex） */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getNewKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * AES-256-GCM 解密。
 * - 空字符串 → 返回 ""
 * - 非三段格式（历史明文兼容）→ 原样返回 + dev warn
 * - 先尝试 ENCRYPTION_KEY；失败回退 JWT_SECRET；都失败抛错（5.13up review 落地）
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";

  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    // 历史明文兼容路径：早期数据可能没走过 encrypt()，此处保留原样以免业务断流。
    if (!isProduction()) {
      console.warn(
        "[crypto] decrypt got plaintext-shaped value, length =",
        ciphertext.length,
      );
    }
    return ciphertext;
  }

  // 1) 新 key
  try {
    return decryptWith(getNewKey(), parts);
  } catch {
    /* fallthrough */
  }

  // 2) 旧 key（JWT_SECRET 派生）
  try {
    return decryptWith(getOldKey(), parts);
  } catch {
    /* fallthrough */
  }

  // 3) 都失败：抛错，禁止返回密文当明文穿透
  throw new Error("decrypt failed: ciphertext could not be decoded with either key");
}
