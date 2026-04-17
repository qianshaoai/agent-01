import { NextRequest } from "next/server";

let counter = 0;

function generateRequestId(): string {
  const ts = Date.now().toString(36);
  const seq = (counter++ % 0xFFFF).toString(16).padStart(4, "0");
  return `${ts}-${seq}`;
}

type LogEntry = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
};

/**
 * 包裹 API handler，自动记录请求日志。
 * 用法：export const GET = withRequestLog(async (req) => { ... return NextResponse.json(...); });
 */
export function withRequestLog<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<Response>
) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const requestId = generateRequestId();
    const start = Date.now();
    let status = 200;
    let errorMsg: string | undefined;

    try {
      const res = await handler(req, ...args);
      status = res.status;

      // 注入 requestId 响应头
      const headers = new Headers(res.headers);
      headers.set("X-Request-Id", requestId);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (err) {
      status = 500;
      errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const entry: LogEntry = {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        status,
        durationMs: Date.now() - start,
      };
      if (errorMsg) entry.error = errorMsg;

      if (status >= 500) {
        console.error("[API]", JSON.stringify(entry));
      } else if (status >= 400) {
        console.warn("[API]", JSON.stringify(entry));
      } else {
        console.log("[API]", JSON.stringify(entry));
      }
    }
  };
}
