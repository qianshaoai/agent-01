/**
 * 6.3up · R1.1 · 工作流可见性统一判定 helper
 *
 * 解决问题：R0/R1 评审 finding 2 发现 5 处可见性判定不一致：
 *   - /api/workflows/route.ts:137         → `org_only` 直接 `return !isPersonal`，不查 permissions
 *   - /api/workflows/[id]/steps/route.ts  → 完全不校验，知 id 即可取步骤
 *   - /api/workflow-sessions/route.ts     → POST 不校验，知 id 即可创会话
 *   - /api/agents/route.ts:142-145        → 最旧口径，只看 visible_to 字面值不查 permissions
 *   - /api/agents/[id]/chat/route.ts:78-98 → 工作流兜底放行没处理 org_only/custom
 *
 * 本 helper 统一口径（评估顺序）：
 *   1. system_admin → 全放行（用户端跳过可见性）
 *   2. org_admin + 工作流在本组织/部门/小组的 resource_permissions → 放行（5.7up 豁免）
 *   3. visible_to === 'all' → 放行
 *   4. visible_to === 'personal_only' → isPersonal=true 放行
 *   5a. visible_to === 'org_only' →
 *        - 该工作流有任何 workflow permissions 行 → 按 permissions 严格判定（命中即放行）
 *        - 该工作流没有任何 workflow permissions 行 → 沿用旧"所有组织用户可见"语义
 *          这是 R1.2 Finding 1 修复：历史 org_only 工作流的创建路径只在 visible_to='custom'
 *          时才写 permissions（[app/api/admin/workflows/route.ts:184]），未配过分层级配置
 *          的纯老数据 permMap 为空，不能按严格 permissions 判定，否则升级后凭空消失。
 *          一旦该工作流被纳入分层级配置（哪怕一条 dept/team perm），即转入严格判定。
 *   5b. visible_to === 'custom' → 查 resource_permissions 命中，不命中 → 不可见
 *        （custom 创建路径强制写 permissions，无兜底需求）
 *   6. 兼容旧数据：visible_to 是逗号分隔租户码 → 命中 tenantCode 放行
 *   7. 其余 → 不可见
 */

import { db } from "@/lib/db";

export type UserVisibilityCtx = {
  userId: string;
  tenantCode: string | null;
  isPersonal: boolean;
  role: string;
  deptId: string | null;
  teamId: string | null;
  /** 5.19up · resource_permissions 已支持 'group' scope（v12 加），需要 user_group_members */
  groupIds: string[];
};

/** buildVisibilityCtx 接受的最小用户上下文（ActiveUser / UserPayload 都兼容） */
type UserLike = {
  userId: string;
  tenantCode?: string | null;
  isPersonal?: boolean;
  role?: string;
};

/**
 * 从 ActiveUser / UserPayload 派生 ctx。dept_id / team_id 需要查 users 表（payload 里没有）。
 * 个人用户不查（恒为 null）。
 */
export async function buildVisibilityCtx(user: UserLike): Promise<UserVisibilityCtx> {
  const tenantCode = user.tenantCode ?? "";
  const isPersonal = user.isPersonal ?? !tenantCode;
  let deptId: string | null = null;
  let teamId: string | null = null;
  let groupIds: string[] = [];
  if (!isPersonal) {
    const [{ data: row }, { data: gRows }] = await Promise.all([
      db.from("users").select("dept_id, team_id").eq("id", user.userId).single(),
      db.from("user_group_members").select("group_id").eq("user_id", user.userId),
    ]);
    deptId = (row as { dept_id: string | null } | null)?.dept_id ?? null;
    teamId = (row as { team_id: string | null } | null)?.team_id ?? null;
    groupIds = ((gRows ?? []) as { group_id: string }[]).map((g) => g.group_id);
  }
  return {
    userId: user.userId,
    tenantCode: tenantCode || null,
    isPersonal,
    role: user.role ?? "user",
    deptId,
    teamId,
    groupIds,
  };
}

type WorkflowRow = { id: string; visible_to: string | null };
type PermRow = { resource_id: string; scope_type: string; scope_id: string | null };

/**
 * 批量判定：返回可见工作流的 id 集合。
 * 一次 DB round-trip：把所有需要查 permissions 的 workflow_id 合并查询。
 */
export async function filterVisibleWorkflows(
  workflows: WorkflowRow[],
  ctx: UserVisibilityCtx
): Promise<Set<string>> {
  if (workflows.length === 0) return new Set();

  // 1. system_admin 全放行
  if (ctx.role === "system_admin") {
    return new Set(workflows.map((w) => w.id));
  }

  // 2. org_admin 在本组织/部门/小组 permissions 命中的工作流 → 豁免
  //    （沿用 5.7up 在 /api/workflows/route.ts:88-113 的实现）
  const orgAdminScopedIds = new Set<string>();
  if (ctx.role === "org_admin" && ctx.tenantCode) {
    const [{ data: depts }, { data: teams }] = await Promise.all([
      db.from("departments").select("id").eq("tenant_code", ctx.tenantCode),
      db.from("teams").select("id").eq("tenant_code", ctx.tenantCode),
    ]);
    const deptIds = (depts ?? []).map((d: { id: string }) => d.id);
    const teamIds = (teams ?? []).map((t: { id: string }) => t.id);
    const orFilters: string[] = [`and(scope_type.eq.org,scope_id.eq.${ctx.tenantCode})`];
    if (deptIds.length > 0) {
      orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
    }
    if (teamIds.length > 0) {
      orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);
    }
    const { data: scoped } = await db
      .from("resource_permissions")
      .select("resource_id")
      .eq("resource_type", "workflow")
      .in("resource_id", workflows.map((w) => w.id))
      .or(orFilters.join(","));
    for (const r of (scoped ?? []) as { resource_id: string }[]) {
      orgAdminScopedIds.add(r.resource_id);
    }
  }

  // 3. 需要查 permissions 的工作流（org_only / custom / 其它非标准值，但排除 personal_only / all）
  const needPermsIds = workflows
    .filter((w) => {
      const vt = w.visible_to;
      if (!vt) return false;
      if (vt === "all" || vt === "personal_only") return false;
      return true; // org_only / custom / 旧逗号分隔 — 都先把权限规则拉出来便于步骤 5/6 判定
    })
    .map((w) => w.id);

  const permMap = new Map<string, PermRow[]>();
  if (needPermsIds.length > 0) {
    const { data: perms } = await db
      .from("resource_permissions")
      .select("resource_id, scope_type, scope_id")
      .eq("resource_type", "workflow")
      .in("resource_id", needPermsIds);
    for (const p of (perms ?? []) as PermRow[]) {
      const arr = permMap.get(p.resource_id) ?? [];
      arr.push(p);
      permMap.set(p.resource_id, arr);
    }
  }

  const tenantCodeUpper = (ctx.tenantCode ?? "").toUpperCase();
  const visible = new Set<string>();

  for (const wf of workflows) {
    // 2. org_admin 豁免命中
    if (orgAdminScopedIds.has(wf.id)) {
      visible.add(wf.id);
      continue;
    }
    const vt = wf.visible_to ?? "";

    // 3. all → 放行
    if (vt === "all") {
      visible.add(wf.id);
      continue;
    }

    // 4. personal_only → isPersonal 才放行
    if (vt === "personal_only") {
      if (ctx.isPersonal) visible.add(wf.id);
      continue;
    }

    // 5a. org_only → 有 perms 严格判定；无 perms 沿用旧"所有组织用户可见"兜底
    //     （R1.2 Finding 1 修复：避免历史 org_only 工作流升级后凭空消失）
    if (vt === "org_only") {
      const rules = permMap.get(wf.id) ?? [];
      if (rules.length === 0) {
        if (!ctx.isPersonal && ctx.tenantCode) visible.add(wf.id);
        continue;
      }
      const hit = rules.some((r) => matchPermRule(r, ctx));
      if (hit) visible.add(wf.id);
      continue;
    }

    // 5b. custom → 必须命中 permissions（创建路径强制写，无兜底需求）
    if (vt === "custom") {
      const rules = permMap.get(wf.id) ?? [];
      const hit = rules.some((r) => matchPermRule(r, ctx));
      if (hit) visible.add(wf.id);
      continue;
    }

    // 6. 兼容旧数据：逗号分隔租户码 → 命中 tenantCode 放行
    //   先尝试 permissions 命中（万一已经迁过来）
    const rules = permMap.get(wf.id) ?? [];
    if (rules.some((r) => matchPermRule(r, ctx))) {
      visible.add(wf.id);
      continue;
    }
    if (tenantCodeUpper) {
      const allowed = vt.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (allowed.includes(tenantCodeUpper)) {
        visible.add(wf.id);
        continue;
      }
    }
    // 7. 其余不可见
  }

  return visible;
}

function matchPermRule(r: PermRow, ctx: UserVisibilityCtx): boolean {
  switch (r.scope_type) {
    case "all":
      return true;
    case "user_type":
      return r.scope_id === (ctx.isPersonal ? "personal" : "organization");
    case "org":
      return !!ctx.tenantCode && r.scope_id === ctx.tenantCode;
    case "dept":
      return !!ctx.deptId && r.scope_id === ctx.deptId;
    case "team":
      return !!ctx.teamId && r.scope_id === ctx.teamId;
    case "user":
      return r.scope_id === ctx.userId;
    case "group":
      return !!r.scope_id && ctx.groupIds.includes(r.scope_id);
    default:
      return false;
  }
}

/**
 * 单个工作流可见性。chat route 等"已经拿到 workflow row"的路径用。
 * 内部走 filterVisibleWorkflows 复用同一套口径。
 */
export async function isWorkflowVisible(
  workflowId: string,
  workflowVisibleTo: string | null,
  ctx: UserVisibilityCtx
): Promise<boolean> {
  const set = await filterVisibleWorkflows(
    [{ id: workflowId, visible_to: workflowVisibleTo }],
    ctx
  );
  return set.has(workflowId);
}

/**
 * 给定可见工作流 id 集合 → 取它们 enabled 步骤的 agent_id 集合。
 * /api/agents/route.ts 在分类页"自动同步工作流智能体"路径上用。
 */
export async function visibleWorkflowAgentIds(
  workflowIds: string[]
): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();
  const { data: steps } = await db
    .from("workflow_steps")
    .select("agent_id")
    .in("workflow_id", workflowIds)
    .eq("enabled", true)
    .not("agent_id", "is", null);
  const ids = new Set<string>();
  for (const s of (steps ?? []) as { agent_id: string | null }[]) {
    if (s.agent_id) ids.add(s.agent_id);
  }
  return ids;
}
