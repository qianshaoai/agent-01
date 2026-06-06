import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase D · D-3 · duplicate 原本零结构闸（R0.1 F8/§7 越权点）→ 补 hierarchy + org scope + v2 duplicate 闸
import { canActOnRole, noWritePermissionMessage, type AdminRole } from "@/lib/admin-permissions";
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { buildPermissionActor } from "@/lib/permission-actor";
// 6.4up v2 Phase D · D-3 Fix · 副本同步克隆 resource_permissions（纯函数挑行）
import { selectDuplicatePermRows, type RawScopeRow } from "@/lib/adapters/access/_scope-utils";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { id } = await params;

  // 查原工作流 + 步骤 + 分类关联
  const { data: src, error } = await db
    .from("workflows")
    .select("created_by_role, name, description, category, sort_order, enabled, visible_to, workflow_steps(step_order, title, description, exec_type, agent_id, button_text, enabled), workflow_categories(category_id)")
    .eq("id", id)
    .single();

  if (error || !src) return apiError("工作流不存在", "NOT_FOUND");

  // org_admin 的本组织 dept/team 归属集：duplicate 守卫与下方副本权限行复制共用，只查一次。
  let orgDeptIds = new Set<string>();
  let orgTeamIds = new Set<string>();
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    const [{ data: depts }, { data: teams }] = await Promise.all([
      db.from("departments").select("id").eq("tenant_code", admin.tenantCode),
      db.from("teams").select("id").eq("tenant_code", admin.tenantCode),
    ]);
    orgDeptIds = new Set((depts ?? []).map((d: { id: string }) => d.id));
    orgTeamIds = new Set((teams ?? []).map((t: { id: string }) => t.id));
  }

  // Phase D D-3 · duplicate 结构闸（R0.1：此路由原本只有 requireAdmin，零 hierarchy/scope 闸 →
  //   org_admin 可复制任意 workflow，含 super 建的，是潜在越权）。此处补齐：
  {
    // 1) 上下级：不能复制比自己等级高的角色建的 workflow（与 PATCH/DELETE 同口径）
    const actorRoleGuard = (admin.role ?? "super_admin") as AdminRole;
    const creatorRole = (src.created_by_role ?? null) as AdminRole | null;
    if (!canActOnRole(actorRoleGuard, creatorRole)) {
      return apiError(noWritePermissionMessage(creatorRole), "FORBIDDEN");
    }
    // 2) org_admin：source 必须归属本组织（resource_permissions 命中本组织/部门/小组）
    if (admin.role === "org_admin") {
      if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
      const tc = admin.tenantCode;
      const deptIds = [...orgDeptIds];
      const teamIds = [...orgTeamIds];
      const orFilters: string[] = [`and(scope_type.eq.org,scope_id.eq.${tc})`];
      if (deptIds.length > 0) orFilters.push(`and(scope_type.eq.dept,scope_id.in.(${deptIds.join(",")}))`);
      if (teamIds.length > 0) orFilters.push(`and(scope_type.eq.team,scope_id.in.(${teamIds.join(",")}))`);
      const { data: hits } = await db
        .from("resource_permissions")
        .select("resource_id")
        .eq("resource_type", "workflow")
        .eq("resource_id", id)
        .or(orFilters.join(","))
        .limit(1);
      if (!hits || hits.length === 0) return apiError("无权复制该工作流", "FORBIDDEN");
    }
    // 3) v2 duplicate 闸（env-gated）
    if (isResourceEnforced("workflow") && admin.role !== "super_admin") {
      const actor = await buildPermissionActor(admin);
      const err = await requireAccess(actor, "workflow", "duplicate", { id });
      if (err) return err;
    }
  }

  // 创建副本工作流
  // 5.11up · 决策 2=A：副本的创建者是当前管理员（不是源工作流的创建者），
  // 当前管理员可以对自己的副本进行任意操作
  const adminRole = (admin.role ?? "super_admin") as "super_admin" | "system_admin" | "org_admin";
  const { data: newWf, error: wfErr } = await db
    .from("workflows")
    .insert({
      name: `${src.name}（副本）`,
      description: src.description,
      category: src.category,
      sort_order: src.sort_order,
      enabled: false,
      visible_to: src.visible_to,
      created_by: admin.adminId,
      created_by_role: adminRole,
    })
    .select()
    .single();

  if (wfErr || !newWf) return apiError("复制工作流失败", "INTERNAL_ERROR");

  // 复制步骤
  const steps = (src.workflow_steps ?? []) as {
    step_order: number; title: string; description: string;
    exec_type: string; agent_id: string | null; button_text: string; enabled: boolean;
  }[];
  if (steps.length > 0) {
    await db.from("workflow_steps").insert(
      steps.map((s) => ({ workflow_id: newWf.id, step_order: s.step_order, title: s.title, description: s.description, exec_type: s.exec_type, agent_id: s.agent_id, button_text: s.button_text, enabled: s.enabled }))
    );
  }

  // 复制分类关联
  const cats = (src.workflow_categories ?? []) as { category_id: string }[];
  if (cats.length > 0) {
    await db.from("workflow_categories").insert(
      cats.map((c) => ({ workflow_id: newWf.id, category_id: c.category_id }))
    );
  }

  // Phase D D-3 Fix · 同步复制源工作流的 resource_permissions 给副本。
  //   缺这步：副本零归属行 → org_admin 列表按归属过滤后副本刷新即"消失"（5.9up 既有逻辑，
  //   不受 enforce 开关控制）；且 workflow enforce 开启后副本读写判定也判不到归属。
  //   super/system 原样克隆；org_admin 归一到本组织范围内的 org/dept/team（见 selectDuplicatePermRows）。
  const { data: srcPerms } = await db
    .from("resource_permissions")
    .select("scope_type, scope_id")
    .eq("resource_type", "workflow")
    .eq("resource_id", id);
  const permRowsToCopy = selectDuplicatePermRows((srcPerms ?? []) as RawScopeRow[], {
    role: adminRole,
    tenantCode: admin.tenantCode ?? null,
    orgDeptIds,
    orgTeamIds,
  });
  if (permRowsToCopy.length > 0) {
    await db.from("resource_permissions").insert(
      permRowsToCopy.map((p) => ({
        resource_type: "workflow",
        resource_id: newWf.id,
        scope_type: p.scope_type,
        scope_id: p.scope_id,
      }))
    );
  }

  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "workflow", resourceId: newWf.id, resourceName: newWf.name,
    detail: { duplicated_from: id },
  });
  return NextResponse.json(newWf, { status: 201 });
}
