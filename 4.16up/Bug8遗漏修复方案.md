# Bug 8 遗漏修复方案

## 问题描述

Bug 8 修复时只改了 Coze、Dify、Yuanqi 三处适配器的 `res.text()` → `res.clone().text()`，遗漏了以下 3 处：

## 待修改位置

### 位置 1：OpenAI 适配器（第 211 行）

**文件**：`lib/adapters/index.ts`

```diff
- throw new Error(`API error: ${res.status} ${await res.text()}`);
+ throw new Error(`API error: ${res.status} ${await res.clone().text()}`);
```

### 位置 2：Qingyan 认证请求（第 239 行）

**文件**：`lib/adapters/index.ts`

```diff
- if (!res.ok) throw new Error(`Qingyan auth error: ${res.status} ${await res.text()}`);
+ if (!res.ok) throw new Error(`Qingyan auth error: ${res.status} ${await res.clone().text()}`);
```

### 位置 3：Qingyan 聊天请求（第 281 行）

**文件**：`lib/adapters/index.ts`

```diff
- if (!res.ok) throw new Error(`Qingyan API error: ${res.status} ${await res.text()}`);
+ if (!res.ok) throw new Error(`Qingyan API error: ${res.status} ${await res.clone().text()}`);
```

## 修改说明

每处只需把 `res.text()` 改为 `res.clone().text()`，共 3 处，改动量极小。

**原因**：`res.text()` 会消费 Response body，如果后续代码尝试通过 `res.body.getReader()` 再次读取（如 `parseSSEStream`），会触发 "body already consumed" 错误。虽然当前逻辑在 `throw` 后不会走到后面，但如果未来调整逻辑（如改为 `return` 或加 fallback），就会触发该问题。使用 `res.clone().text()` 可以安全地读取错误信息而不消费原始 body。
