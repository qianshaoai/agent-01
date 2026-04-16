import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM 加密，返回 "iv:authTag:ciphertext"（均为 hex） */
export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** AES-256-GCM 解密；如果格式不对（旧明文数据），原样返回保持兼容 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext; // 旧明文数据，兼容返回
  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return ciphertext; // 解密失败，当作旧明文
  }
}
