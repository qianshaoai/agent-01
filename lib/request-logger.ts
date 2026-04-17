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
  userId?: string;
  error?: string;
};

/** 包裹 API handler，自动记录请求日志（requestId、method、path、耗时、状态码） */
export function withRequestLog(
  handler: (req: NextRequest, ctx: { requestId: string }) => Promise<Response>
) {
  return async (req: NextRequest, ...args: unknown[]): Promise<Response> => {
    const requestId = generateRequestId();
    const start = Date.now();
    let status = 200;
    let errorMsg: string | undefined;

    try {
      // 透传 Next.js 的 route params（第二个参数）
      const res = await (handler as Function)(req, { requestId, ...(args[0] as object ?? {}) });
      status = res.status;

      // 将 requestId 注入响应头，方便前端/调试追踪
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

      // 结构化日志输出
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
