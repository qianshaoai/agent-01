import { NextRequest } from "next/server";
import { ZodSchema, ZodError } from "zod";
import { apiError } from "@/lib/api-error";

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * 解析并校验请求体。超过 2MB 或 schema 校验失败返回错误 Response。
 * 用法：
 *   const result = await parseBody(req, mySchema);
 *   if (result instanceof Response) return result;
 *   const data = result; // typed
 */
export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T | Response> {
  // 大小限制
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
    return apiError("请求体过大（上限 2MB）", "VALIDATION_ERROR");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError("请求体不是合法的 JSON", "VALIDATION_ERROR");
  }

  // Schema 校验
  const result = schema.safeParse(raw);
  if (!result.success) {
    const msg = (result.error as ZodError).issues.map((i) => i.message).join("; ");
    return apiError(msg || "参数校验失败", "VALIDATION_ERROR");
  }

  return result.data;
}
