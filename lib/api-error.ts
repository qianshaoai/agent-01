import { NextResponse } from "next/server";

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** 生成统一错误响应，永远不暴露数据库原始错误 */
export function apiError(message: string, code: ErrorCode = "INTERNAL_ERROR") {
  return NextResponse.json(
    { error: message },
    { status: STATUS_MAP[code] }
  );
}

/** 安全地将数据库错误转为用户友好消息 */
export function dbError(error: { message?: string; code?: string } | null, fallback = "操作失败，请稍后重试") {
  if (!error) return apiError(fallback);

  // PostgreSQL 唯一约束冲突
  if (error.code === "23505") return apiError("记录已存在", "CONFLICT");
  // 外键约束
  if (error.code === "23503") return apiError("关联数据不存在", "VALIDATION_ERROR");
  // 非空约束
  if (error.code === "23502") return apiError("缺少必填字段", "VALIDATION_ERROR");

  // 不暴露原始 message，用 fallback
  console.error("[db error]", error.code, error.message);
  return apiError(fallback);
}
