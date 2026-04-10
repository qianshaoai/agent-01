// 权限计算工具：计算某个用户在当前系统下能看到哪些资源
// 读取 resource_permissions 表，按 scope_type 聚合，返回该用户可见的 workflows 与 agents
import { db } from "@/lib/db";

type VisibleItem = { id: string; name: string; category: string | null };
type Visibility = {
  workflows: VisibleItem[];
  agents: VisibleItem[];
};

type UserCtx = {
  id: string;
  tenant_code: string | null;
  user_type: "personal" | "organization";
  dept_id: string | null;
  team_id: string | null;
};

/**
 * 计算用户能看到的所有 workflows 和 agents
 */
export async function getVisibleResourcesForUser(userId: string): Promise<Visibility> {
  // 1. 取用户上下文
  const { data: user } = await db
    .from("users")
    .select("id, tenant_code, user_type, dept_id, team_id")
    .eq("id", userId)
    .single();

  if (!user) return { workflows: [], agents: [] };
  const ctx = user as UserCtx;

  // 2. 该用户所属的分组 id 列表
  const { data: groupRows } = await db
    .from("user_group_members")
    .select("group_id")
    .eq("user_id", userId);
  const userGroupIds = (groupRows ?? []).map((g: { group_id: string }) => g.group_id);

  // 3. 拉取所有 resource_permissions
  const { data: allPerms } = await db
    .from("resource_permissions")
    .select("resource_type, resource_id, scope_type, scope_id");
  const perms = allPerms ?? [];

  // 4. 判断某条权限是否对该用户生效
  function matchesUser(p: {
    scope_type: string;
    scope_id: string | null;
  }): boolean {
    switch (p.scope_type) {
      case "all":
        return true;
      case "user_type":
        return p.scope_id === ctx.user_type;
      case "org":
        return !!ctx.tenant_code && p.scope_id === ctx.tenant_code;
      case "dept":
        return !!ctx.dept_id && p.scope_id === ctx.dept_id;
      case "team":
        return !!ctx.team_id && p.scope_id === ctx.team_id;
      case "user":
        return p.scope_id === ctx.id;
      case "group":
        return !!p.scope_id && userGroupIds.includes(p.scope_id);
      default:
        return false;
    }
  }

  const visibleWorkflowIds = new Set<string>();
  const visibleAgentIds = new Set<string>();
  for (const p of perms) {
    if (!matchesUser(p)) continue;
    if (p.resource_type === "workflow") visibleWorkflowIds.add(p.resource_id);
    if (p.resource_type === "agent") visibleAgentIds.add(p.resource_id);
  }

  // 5. 取回 workflow / agent 的显示信息
  const [wfRes, agRes] = await Promise.all([
    visibleWorkflowIds.size > 0
      ? db.from("workflows").select("id, name, category").in("id", [...visibleWorkflowIds])
      : Promise.resolve({ data: [] }),
    visibleAgentIds.size > 0
      ? db
          .from("agents")
          .select("id, name, categories(name)")
          .in("id", [...visibleAgentIds])
      : Promise.resolve({ data: [] }),
  ]);

  const workflows: VisibleItem[] = (wfRes.data ?? []).map(
    (w: { id: string; name: string; category: string | null }) => ({
      id: w.id,
      name: w.name,
      category: w.category ?? null,
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents: VisibleItem[] = ((agRes.data ?? []) as any[]).map((a) => {
    const catName = Array.isArray(a.categories) ? a.categories[0]?.name : a.categories?.name;
    return {
      id: a.id as string,
      name: a.name as string,
      category: catName ?? null,
    };
  });

  return { workflows, agents };
}
