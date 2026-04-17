// 集中管理所有可配置项，从环境变量读取，提供合理默认值

function envInt(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (!v) return defaultValue;
  const n = parseInt(v, 10);
  return isNaN(n) ? defaultValue : n;
}

/** 认证相关 */
export const AUTH = {
  /** JWT Token 有效期（秒），默认 7 天 */
  TOKEN_TTL_SEC: envInt("AUTH_TOKEN_TTL_SEC", 7 * 24 * 60 * 60),
  /** Cookie Max-Age（秒），默认 30 天 */
  COOKIE_MAX_AGE_SEC: envInt("AUTH_COOKIE_MAX_AGE_SEC", 30 * 24 * 60 * 60),
} as const;

/** 登录限流 */
export const RATE_LIMIT = {
  /** 时间窗口（毫秒），默认 15 分钟 */
  WINDOW_MS: envInt("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  /** 窗口内最大失败次数，默认 5 */
  MAX_FAIL: envInt("RATE_LIMIT_MAX_FAIL", 5),
  /** 锁定时间（毫秒），默认 15 分钟 */
  LOCK_MS: envInt("RATE_LIMIT_LOCK_MS", 15 * 60 * 1000),
} as const;

/** 分页 */
export const PAGINATION = {
  /** 每页默认条数 */
  DEFAULT_PAGE_SIZE: envInt("PAGINATION_DEFAULT_SIZE", 20),
  /** 每页最大条数 */
  MAX_PAGE_SIZE: envInt("PAGINATION_MAX_SIZE", 100),
  /** 列表安全上限（非分页接口） */
  LIST_LIMIT: envInt("PAGINATION_LIST_LIMIT", 500),
} as const;

/** 聊天上下文 */
export const CHAT = {
  /** 最大上下文轮数（每轮 = user + assistant） */
  MAX_CONTEXT_TURNS: envInt("CHAT_MAX_CONTEXT_TURNS", 20),
} as const;
