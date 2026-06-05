/**
 * 6.4up v2 Phase A · agent_draft（搭建器草稿）permission keys
 *
 * 与 `agent`（已发布智能体）是独立的 key 空间——
 * "我有 agent.update.org" 不蕴含 "我能 publish 草稿"，方案 R10 已说明（UI Tab 1 矩阵
 * 按资源分块、tooltip 说"草稿与已发布是独立权限"避免混淆）。
 *
 * 路由对应：app/api/admin/agent-drafts/**
 */

export const AGENT_DRAFT_PERMISSION_KEYS = [
  // read
  "agent_draft.read.org",
  "agent_draft.read.all",
  // create
  "agent_draft.create.org",
  "agent_draft.create.all",
  // update（含 PATCH /[id]、builder_config 修改等）
  "agent_draft.update.org",
  "agent_draft.update.all",
  // publish（POST /[id]/publish → 写 agents 表）
  "agent_draft.publish.org",
  "agent_draft.publish.all",
  // duplicate（POST /[id]/duplicate）
  "agent_draft.duplicate.org",
  "agent_draft.duplicate.all",
  // test（POST /[id]/test-chat）—— 独立于 read，仅试聊不读 raw 配置
  "agent_draft.test.org",
  "agent_draft.test.all",
  // delete
  "agent_draft.delete.org",
  "agent_draft.delete.all",
] as const;

export type AgentDraftPermissionKey = (typeof AGENT_DRAFT_PERMISSION_KEYS)[number];
