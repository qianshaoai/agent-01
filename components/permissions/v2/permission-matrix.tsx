"use client";
/**
 * 6.4up v2 Phase B · 共用权限矩阵（按 resource 分块的 checkbox 网格）
 *
 * 给 Tab 1（个人权限详情）和 Tab 2（角色默认包编辑）共用。
 *
 * 渲染规则（D4 约束）：
 *   - 按 resource 分块（workflow / agent / agent_draft / kb / provider / notice / user / tenant / category / dept / team / audit）
 *   - 每块内按 action 分行，每行按 scope（team < dept < org < all）排
 *   - checkbox 三态展示（Tab 1 详情用）：
 *       默认包持有 ➜ 灰底 + check
 *       grant 加持   ➜ 绿底 + check + "G" 角标
 *       revoke 移除  ➜ 红底 + - + "R" 角标
 *       未持有       ➜ 白底 + 空
 *   - editable=false 时 checkbox 禁用（详情查看模式）
 */

import React from "react";

export type AdminScopeKind = "team" | "dept" | "org" | "all";

export type PermissionKeyParts = {
  key: string;
  resource: string;
  action: string;
  scope: AdminScopeKind;
};

export const RESOURCE_LABEL: Record<string, string> = {
  workflow: "工作流",
  agent: "智能体（已发布）",
  agent_draft: "智能体（草稿）",
  kb: "知识库",
  provider: "API 管理",
  notice: "公告",
  user: "用户",
  tenant: "组织",
  category: "分类",
  dept: "部门",
  team: "小组",
  audit: "审计",
};

export const RESOURCE_ORDER = [
  "workflow",
  "agent",
  "agent_draft",
  "kb",
  "provider",
  "notice",
  "user",
  "tenant",
  "category",
  "dept",
  "team",
  "audit",
];

export const ACTION_LABEL: Record<string, string> = {
  read: "查看",
  create: "新建",
  update: "编辑",
  delete: "删除",
  enable: "启停",
  duplicate: "复制",
  test: "试跑",
  publish: "发布",
  reindex: "重建索引",
  "basic.update": "基础信息",
  "role.update": "角色调整",
  "tenant.transfer": "调组织",
  "department.assign": "调部门",
  "team.assign": "调小组",
  "password.reset": "重置密码",
};

export const SCOPE_LABEL: Record<AdminScopeKind, string> = {
  team: "本小组",
  dept: "本部门",
  org: "本组织",
  all: "全平台",
};

export const SCOPE_ORDER: AdminScopeKind[] = ["team", "dept", "org", "all"];

/** 拆 "resource.action.scope" / "resource.sub.action.scope"（user.role.update.org 等） */
export function splitKey(key: string): PermissionKeyParts | null {
  const parts = key.split(".");
  if (parts.length < 3) return null;
  const scope = parts[parts.length - 1] as AdminScopeKind;
  if (!SCOPE_ORDER.includes(scope)) return null;
  const resource = parts[0];
  const action = parts.slice(1, parts.length - 1).join(".");
  return { key, resource, action, scope };
}

export type CellState = "default" | "grant" | "revoke" | "off";

export type CellStateResolver = (key: string) => CellState;

export function PermissionMatrix(props: {
  /** 全集 keys（来自 by_resource / ADMIN_PERMISSION_KEYS） */
  allKeys: readonly string[];
  /** 状态查询：每 cell 显示什么 */
  resolveCellState: CellStateResolver;
  /** Tab 2 编辑模式：onToggle 接 default↔off；不区分 grant/revoke（那是 Tab 1 用） */
  editable?: boolean;
  onToggle?: (key: string, nextOn: boolean) => void;
}) {
  const { allKeys, resolveCellState, editable = false, onToggle } = props;

  // 按 resource 分组
  const grouped: Record<string, PermissionKeyParts[]> = {};
  for (const k of allKeys) {
    const p = splitKey(k);
    if (!p) continue;
    (grouped[p.resource] ??= []).push(p);
  }
  // 排序 resources
  const resources = RESOURCE_ORDER.filter((r) => grouped[r]?.length);
  // 兜底未在 RESOURCE_ORDER 的也展示
  for (const r of Object.keys(grouped)) {
    if (!resources.includes(r)) resources.push(r);
  }

  return (
    <div className="space-y-4">
      {resources.map((resource) => {
        const items = grouped[resource];
        // 按 action 分组
        const byAction: Record<string, PermissionKeyParts[]> = {};
        for (const it of items) {
          (byAction[it.action] ??= []).push(it);
        }
        const actions = Object.keys(byAction).sort();

        return (
          <div
            key={resource}
            className="border border-gray-200 rounded-[10px] p-3 bg-white"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-semibold text-gray-800">
                {RESOURCE_LABEL[resource] ?? resource}
              </p>
              <code className="text-[11px] text-gray-400 font-mono">{resource}</code>
            </div>
            <div className="space-y-1.5">
              {actions.map((action) => {
                const row = byAction[action];
                row.sort(
                  (a, b) =>
                    SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope),
                );
                return (
                  <div key={action} className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] text-gray-500 min-w-[72px] shrink-0">
                      {ACTION_LABEL[action] ?? action}
                    </span>
                    {row.map((it) => (
                      <CellChip
                        key={it.key}
                        keyName={it.key}
                        scope={it.scope}
                        state={resolveCellState(it.key)}
                        editable={editable}
                        onToggle={onToggle}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CellChip(props: {
  keyName: string;
  scope: AdminScopeKind;
  state: CellState;
  editable: boolean;
  onToggle?: (key: string, nextOn: boolean) => void;
}) {
  const { keyName, scope, state, editable, onToggle } = props;
  const label = SCOPE_LABEL[scope];
  const isOn = state === "default" || state === "grant";

  // 配色 / 角标
  let cls = "bg-white text-gray-400 border-gray-200";
  let badge: React.ReactNode = null;
  if (state === "default") {
    cls = "bg-[#002FA7]/8 text-[#002FA7] border-[#002FA7]/15";
  } else if (state === "grant") {
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
    badge = (
      <span className="ml-1 text-[10px] font-bold opacity-80">G</span>
    );
  } else if (state === "revoke") {
    cls = "bg-rose-50 text-rose-600 border-rose-200";
    badge = (
      <span className="ml-1 text-[10px] font-bold opacity-80">R</span>
    );
  }

  const interactive = editable && onToggle;

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => onToggle?.(keyName, !isOn)}
      title={keyName}
      className={
        "text-[12px] px-2.5 py-1 rounded-full border transition-colors " +
        cls +
        (interactive
          ? " hover:border-[#002FA7]/40 cursor-pointer"
          : " cursor-default")
      }
    >
      {label}
      {badge}
    </button>
  );
}
