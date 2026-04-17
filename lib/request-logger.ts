import { NextRequest } from "next/server";

/**
 * 为核心业务路由增加详细日志：状态码 + 耗时。
 * 基础日志（method/path/requestId/timestamp）由 middleware.ts 全局覆盖。
 * 用法：
 *   export const POST = withRequestLog(async (req, ctx) => { ... });
 */
export function withRequestLog<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<Response>
) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const start = Date.now();
    let status = 200;
    let errorMsg: string | undefined;
    try {
      const res = await handler(req, ...args);
      status = res.status;
      return res;
    } catch (err) {
      status = 500;
      errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const entry: { method: string; path: string; status: number; durationMs: number; error?: string } = {
        method: req.method,
        path: req.nextUrl.pathname,
        status,
        durationMs: Date.now() - start,
      };
      if (errorMsg) entry.error = errorMsg;

      if (status >= 500) console.error("[API-DETAIL]", JSON.stringify(entry));
      else if (status >= 400) console.warn("[API-DETAIL]", JSON.stringify(entry));
      else console.log("[API-DETAIL]", JSON.stringify(entry));
    }
  };
}
