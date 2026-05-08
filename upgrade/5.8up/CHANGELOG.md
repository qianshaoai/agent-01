# 变更记录

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

