import { NextRequest } from "next/server";

type RequestTimingState = {
  startedAt: number;
  authDoneAt?: number;
  businessDoneAt?: number;
  actorSource?: string;
  actorRole?: string;
};

const requestTimings = new WeakMap<NextRequest, RequestTimingState>();

export function markRequestAuth(
  req: NextRequest,
  actor?: { source?: string | null; role?: string | null },
): void {
  const state = requestTimings.get(req);
  if (!state) return;
  state.authDoneAt = performance.now();
  state.actorSource = actor?.source ?? undefined;
  state.actorRole = actor?.role ?? undefined;
}

export function markRequestBusiness(req: NextRequest): void {
  const state = requestTimings.get(req);
  if (!state) return;
  state.businessDoneAt = performance.now();
}

/**
 * 为核心业务路由贯通 requestId、响应头和结构化耗时日志。
 * middleware 会把 x-request-id 传入下游；测试、内部调用或绕过 middleware
 * 的请求在这里生成兜底 ID。
 * 用法：
 *   export const POST = withRequestLog(async (req, ctx) => { ... });
 */
export function withRequestLog<T extends unknown[]>(
  handler: (req: NextRequest, ...args: T) => Promise<Response>
) {
  return async (req: NextRequest, ...args: T): Promise<Response> => {
    const start = performance.now();
    const timingState: RequestTimingState = { startedAt: start };
    requestTimings.set(req, timingState);
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    let status = 200;
    let errorMsg: string | undefined;
    let responseBytes: number | null = null;
    let authMs: number | null = null;
    let businessMs: number | null = null;
    let serializeMs: number | null = null;
    try {
      const res = await handler(req, ...args);
      status = res.status;
      const responseReadyAt = performance.now();
      authMs = timingState.authDoneAt === undefined
        ? null
        : timingState.authDoneAt - timingState.startedAt;
      businessMs = timingState.authDoneAt === undefined || timingState.businessDoneAt === undefined
        ? null
        : timingState.businessDoneAt - timingState.authDoneAt;
      serializeMs = timingState.businessDoneAt === undefined
        ? null
        : responseReadyAt - timingState.businessDoneAt;

      const timingParts = [
        authMs === null ? null : `auth;dur=${authMs.toFixed(1)}`,
        businessMs === null ? null : `business;dur=${businessMs.toFixed(1)}`,
        serializeMs === null ? null : `serialize;dur=${serializeMs.toFixed(1)}`,
        `total;dur=${(responseReadyAt - start).toFixed(1)}`,
      ].filter((part): part is string => part !== null);
      res.headers.set("X-Request-Id", requestId);
      res.headers.set("Server-Timing", timingParts.join(", "));
      const contentLength = res.headers.get("content-length");
      // 不为统计字节数克隆响应体；否则每个 JSON 响应都会额外分配一份内存，
      // 既增加 GC/延迟，又让 Server-Timing 看不到复制成本。
      responseBytes = contentLength ? Number(contentLength) : null;
      return res;
    } catch (err) {
      status = 500;
      errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const entry: {
        requestId: string;
        method: string;
        path: string;
        status: number;
        durationMs: number;
        authMs: number | null;
        businessMs: number | null;
        serializeMs: number | null;
        responseBytes: number | null;
        actorSource?: string;
        actorRole?: string;
        error?: string;
      } = {
        requestId,
        method: req.method,
        path: req.nextUrl.pathname,
        status,
        durationMs: Number((performance.now() - start).toFixed(1)),
        authMs: authMs === null ? null : Number(authMs.toFixed(1)),
        businessMs: businessMs === null ? null : Number(businessMs.toFixed(1)),
        serializeMs: serializeMs === null ? null : Number(serializeMs.toFixed(1)),
        responseBytes,
      };
      if (timingState.actorSource) entry.actorSource = timingState.actorSource;
      if (timingState.actorRole) entry.actorRole = timingState.actorRole;
      if (errorMsg) entry.error = errorMsg;

      if (status >= 500) console.error("[API-DETAIL]", JSON.stringify(entry));
      else if (status >= 400) console.warn("[API-DETAIL]", JSON.stringify(entry));
      else console.log("[API-DETAIL]", JSON.stringify(entry));
      requestTimings.delete(req);
    }
  };
}
