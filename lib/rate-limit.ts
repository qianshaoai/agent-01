// 极简内存级登录限流
// 说明：
//   - Vercel/Next 的无服务器模式下，每个实例各自持有一份窗口数据
//   - 对于暴力破解场景（单 IP 持续请求命中同一实例）足够用
//   - 想要强保证需要接入 Redis/KV，属于下一阶段

import { RATE_LIMIT } from "@/lib/config";

type WindowEntry = {
  count: number;        // 窗口内失败次数
  firstAt: number;      // 窗口起点（毫秒时间戳）
  lockedUntil?: number; // 锁定结束时间（毫秒时间戳）
};

const WINDOW_MS = RATE_LIMIT.WINDOW_MS;
const MAX_FAIL = RATE_LIMIT.MAX_FAIL;
const LOCK_MS = RATE_LIMIT.LOCK_MS;

const store = new Map<string, WindowEntry>();

// 定期清理过期记录，避免内存泄漏
function gc() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    const expired =
      (entry.lockedUntil && entry.lockedUntil < now) ||
      (!entry.lockedUntil && now - entry.firstAt > WINDOW_MS);
    if (expired) store.delete(key);
  }
}

/**
 * 登录前检查是否被锁定
 * @returns { locked: true, retryAfterSec: number } 当前处于锁定期
 * @returns { locked: false } 允许尝试
 */
export function checkLoginRate(key: string): { locked: boolean; retryAfterSec?: number } {
  if (Math.random() < 0.05) gc();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry) return { locked: false };
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  // 窗口过期 → 重置
  if (now - entry.firstAt > WINDOW_MS) {
    store.delete(key);
    return { locked: false };
  }
  return { locked: false };
}

/**
 * 登录失败时记录一次；超过阈值时进入锁定期
 */
export function recordLoginFail(key: string): void {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    store.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_FAIL) {
    entry.lockedUntil = now + LOCK_MS;
  }
}

/**
 * 登录成功时清空该 key 的记录
 */
export function clearLoginFail(key: string): void {
  store.delete(key);
}
