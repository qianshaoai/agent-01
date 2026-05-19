import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

// 5.14up PR-B · 智能体草稿列表 + 新增
// 权限：super_admin + system_admin 可见 / 创建；org_admin 不可
// 默认可见性：owner_only（小A D-3 推荐，发布时由 super_admin 在 UI 扩大范围）

type DraftRow = {
  id: string;
  source_agent_id: string | null;
  name: string;
  description: string;
  category_ids: string[];
  provider_id: string | null;
  agent_type: "chat" | "external";
  external_url: string;
  builder_config: Record<string, unknown>;
  model_params: Record<string, unknown>;
  visibility_config: { visible_to: string; scope: unknown[] };
  status: "draft" | "testing" | "published" | "archived";
  published_agent_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 5.19up · org_admin 可用搭建器，但列表只看自己创建的草稿
  let query = db
    .from("agent_drafts")
    .select("*")
    .neq("status", "archived");
  if (admin.role === "org_admin") query = query.eq("created_by", admin.adminId);
  const { data, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    console.error("[agent-drafts list]", error);
    return apiError("获取列表失败", "INTERNAL_ERROR");
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.19up · org_admin 可创建草稿（created_by 即本人，列表/编辑/发布均按此归属）

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "未命名智能体").trim() || "未命名智能体";

  const payload = {
    name,
    description: String(body.description ?? ""),
    category_ids: Array.isArray(body.category_ids) ? body.category_ids : [],
    provider_id: typeof body.provider_id === "string" ? body.provider_id : null,
    agent_type: body.agent_type === "external" ? "external" : "chat",
    external_url: String(body.external_url ?? ""),
    builder_config: body.builder_config && typeof body.builder_config === "object" ? body.builder_config : {},
    model_params: body.model_params && typeof body.model_params === "object" ? body.model_params : {},
    visibility_config:
      body.visibility_config && typeof body.visibility_config === "object"
        ? body.visibility_config
        : { visible_to: "owner_only", scope: [] },
    status: "draft" as const,
    created_by: admin.adminId,
    updated_by: admin.adminId,
  };

  const { data, error } = await db
    .from("agent_drafts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("[agent-drafts create]", error);
    return apiError("创建草稿失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    action: "create",
    resourceType: "agent_draft",
    resourceId: data.id,
    resourceName: name,
  });

  return NextResponse.json(data as DraftRow);
}
