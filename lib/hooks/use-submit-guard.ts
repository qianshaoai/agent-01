"use client";
import { useRef, useState } from "react";

// 5.27up Fix · 防重复提交统一 hook（A useRef 同步锁 + B 客户端幂等键）
//
// 起因：后台所有「新建 / 复制 / 保存」按钮都有同一个 race —— React state 是异步的，
//   `setCreating(true)` 与渲染 `disabled` 之间存在 1-50ms 窗口（dev 冷编译时拉到秒级），
//   用户连点会发出多个 POST、各生一条新行。
//
// 解决：
//   A. useRef 同步锁 —— `locked.current = true` 在 onClick 第一行同步生效，绕开
//      React state 异步窗口；并发 submit 直接 return undefined。
//   B. 客户端幂等键（Idempotency Key, Stripe 同款方案）—— 每次"意图"生成一个 UUID
//      塞进 fetch header `Idempotency-Key`；fetch 成功后清空 key（下次新意图新 key），
//      失败时**保留 key**（用户重试是同一意图，未来服务端做去重时可以识别同一意图）。
//
// 用法：
//   const submitGuard = useSubmitGuard();
//   async function create() {
//     await submitGuard.submit(async (idempotencyKey) => {
//       const res = await fetch("/api/...", {
//         method: "POST",
//         headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
//         body: JSON.stringify({ ... }),
//       });
//       // ... existing 业务逻辑（toast / router.push / loadList ...）
//     });
//   }
//   <Button onClick={create} loading={submitGuard.loading}>新建</Button>
//
// 注意：
//   - submit 的 action 内可以照常 throw（hook 不吞错误），caller 用 try/catch 拿 error
//     toast。reject 的 promise 不会重置 key（让重试同意图）。
//   - 当前服务端尚未消费 `Idempotency-Key` 做去重；本 hook 先把客户端那一层做对，
//     即"按钮拦不住的极端 race"留给将来服务端兜底（参考 changelog 5.27up P3）。

export type SubmitGuard = {
  /** 包一层用户操作；同时只允许一个并发 action 进行 */
  submit: <T>(action: (idempotencyKey: string) => Promise<T>) => Promise<T | undefined>;
  /** 配合 <Button loading={...}> / spinner UI 用 */
  loading: boolean;
};

export function useSubmitGuard(): SubmitGuard {
  const locked = useRef(false);
  const keyRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit<T>(
    action: (idempotencyKey: string) => Promise<T>,
  ): Promise<T | undefined> {
    if (locked.current) return undefined;
    locked.current = true;
    if (!keyRef.current) keyRef.current = newUuid();
    const key = keyRef.current;
    setLoading(true);
    try {
      const result = await action(key);
      keyRef.current = null; // 成功 → 新意图换新 key
      return result;
    } finally {
      locked.current = false;
      setLoading(false);
    }
  }

  return { submit, loading };
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // 兜底：极老的浏览器 / 测试环境没 crypto.randomUUID 时退回 timestamp + random
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
