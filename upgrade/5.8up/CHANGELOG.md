# 变更记录

---

## 5.8up · 工作流多会话 + UI 迭代（2026-05-08 下午）

详见 [`变更记录-20260508.md`](./变更记录-20260508.md)

### 主菜：工作流多会话（5.9 主菜）

**目标**：让用户同时跑同一个工作流的多个独立实例（如「项目A资料整理」「项目B资料整理」），对话记录完全隔离。

#### 数据库
| 文件 | 说明 |
|------|------|
| `supabase/migration_v29.sql` | 新增 `workflow_sessions` 表（user_id / workflow_id / name / current_step_idx / status） |
| `supabase/migration_v30.sql` | `conversations` 加 `session_id uuid` 列 |

#### 新增 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `app/api/workflow-sessions/route.ts` | GET / POST | 列出当前用户进行中会话 / 新建会话 |
| `app/api/workflow-sessions/[id]/route.ts` | PATCH / DELETE | 改名 / 改进度 / 删除（owner-only） |

#### 修改文件
| 文件 | 修改内容 |
|------|---------|
| `app/api/conversations/route.ts` | 新增 `?sessionId=` 过滤；select 加 `session_id` |
| `app/api/agents/[id]/chat/route.ts` | 请求体加 `sessionId`，写入新 conversation |
| `app/agents/[id]/page.tsx` | 读取 URL `?session=` 参数，对话列表 / 跨步骤上下文 / chat body 全链路按 sessionId 隔离；`advanceFrom` 推进时 PATCH session 进度 |
| `app/page.tsx` | 「我的进行中工作流」折叠区块 + 横向轮播 + 命名/重命名弹窗；工作流详情页加「开始新会话」按钮 |

### UI 迭代（用户多轮反馈）

| 迭代 | 实施 |
|------|------|
| 进行中会话区块可折叠 | 标题加 `▼`，状态写入 `localStorage('wf_sessions_expanded')` |
| 区分进行中 vs 全部 | 工作流网格上方加「全部工作流 (N)」标题（不可折叠） |
| 横向轮播 | 卡片 `w-[calc(50%-4px)]` + `snap-mandatory`；滚轮转横向；标题栏右侧两个圆形箭头按钮，到边界禁用 |
| 单会话全宽 | `mySessions.length === 1 ? 'w-full' : 'w-[calc(50%-4px)]'` |
| 重命名 | 卡片加铅笔按钮 + 弹窗；复用现有 PATCH，乐观更新 |

### Bug 修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 「继续」按钮无反应 | React 18+ batching 吞掉 `router.push` | 改 `window.location.assign` + iterative `advanceFrom` |
| 同一 agent 跨多步骤时进度条不动 | `findIndex` 只返回首个匹配 | 优先用 URL `?step=` 参数（指向当前 agent 时） |
| 「全部」视图刷新跳到上次工作流详情 | `selectWorkflow` 不同步 URL，`?wf=` 残留 | `selectWorkflow` 加 `history.replaceState` |
| 横向滚动箭头偶发不显示 | `ResizeObserver` 只观察容器，子元素尺寸晚到测不到 | 同时观察每张卡片 + 50/200/500ms 多次延迟兜底 |
| 弹窗 autoFocus 触发页面滚动 | `<input autoFocus>` 在 fixed 弹窗里被错误 scroll-into-view | 改 `focus({ preventScroll: true })` |

---

## 5.8up · 工作流步骤进度条（2026-05-08）

### 新功能

**多智能体工作流进度条**：用户使用带有多个智能体步骤的工作流时，聊天页顶部显示水平进度条，支持步骤导航和跨步骤上下文传递。

#### 交互逻辑
- 已完成步骤显示绿色勾，当前步骤蓝色高亮，未到达步骤灰色
- 人工参与步骤（exec_type 非 agent）显示琥珀色，进入下一步前提示用户手动完成
- 点击「下一步」弹出确认框，进入下一个智能体步骤
- 上一步的完整对话内容自动注入到下一步智能体的首条消息，无需用户重复说明
- 已完成步骤可点击回溯

#### 新增文件
| 文件 | 说明 |
|------|------|
| `app/api/workflows/[id]/steps/route.ts` | GET 接口，返回工作流步骤列表及智能体信息 |

#### 修改文件
| 文件 | 修改内容 |
|------|---------|
| `app/page.tsx` | WorkflowStepButton 传入 stepIndex |
| `components/workflow-step-button.tsx` | 新增 stepIndex prop，href 携带 step 参数 |
| `app/agents/[id]/page.tsx` | 进度条 UI、步骤导航逻辑、跨步骤上下文注入 |
| `app/api/agents/[id]/chat/route.ts` | workflowContext 注入到 user message（兼容所有平台） |
| `app/api/conversations/[id]/messages/route.ts` | 新增 force-dynamic、会话归属校验 |

### Bug 修复

| 问题 | 原因 | 修复 |
|------|------|------|
| 进度条高亮错误步骤 | URL `step` 参数使用首页 map 下标，与 API 返回顺序不一致 | 改用 agent_code 在 wfSteps 中反查实际下标（`resolvedStepIdx`） |
| 跨步骤上下文未传递 | 依赖 URL `from` 参数，该参数经常为空 | 改为自动查找上一个智能体步骤的最新对话 |
| Coze/Dify/Yuanqi 收不到上下文 | 上下文注入为 system 消息，这些平台不支持 system role | 改为拼入 user message 内容，displayContent（入库）不含上下文 |
| 删除/重命名失败提示常驻 | `setError` 后从未清除 | 新增 useEffect：error 出现 3 秒后自动清除 |

---

## 5.7up · 历史变更

> 详见各版本的方案文档（如有）。

