import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

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
    .select("name, description, category, sort_order, enabled, visible_to, workflow_steps(step_order, title, description, exec_type, agent_id, button_text, enabled), workflow_categories(category_id)")
    .eq("id", id)
    .single();

  if (error || !src) return apiError("工作流不存在", "NOT_FOUND");

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

  await writeAuditLog({
    adminId: admin.adminId, adminUsername: admin.username, adminRole: admin.role, adminTenantCode: admin.tenantCode ?? null,
    action: "create", resourceType: "workflow", resourceId: newWf.id, resourceName: newWf.name,
    detail: { duplicated_from: id },
  });
  return NextResponse.json(newWf, { status: 201 });
}
