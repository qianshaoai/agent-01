import { apiError } from "@/lib/api-error";
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import type { AdminPayload } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import { canReadRow } from "@/lib/scoped-access";
import { hasPermission, type ResourceScope } from "@/lib/permission-actor";
import type { PermissionKey } from "@/lib/permission-keys";
import { NextRequest, NextResponse } from "next/server";

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

type TenantOwnedRow = { id: string; tenant_code: string | null };

async function canReadTenantOwned(
  ctx: AdminActorContext,
  resourceKind: "model_provider" | "knowledge_base",
  row: TenantOwnedRow,
) {
  if (ctx.isCustomAdmin) {
    return !(await requireAccess(ctx.actor, resourceKind, "read", { row }));
  }
  return canReadRow(ctx.access as AdminPayload, row);
}

function ownDraftScopes(ctx: AdminActorContext): ResourceScope[] {
  return ctx.actor.tenantCode
    ? [{ scope_type: "org", scope_id: ctx.actor.tenantCode }]
    : [{ scope_type: "all", scope_id: null }];
}

async function canUseCreatedDraft(
  ctx: AdminActorContext,
  action: "read" | "update",
): Promise<boolean> {
  if (ctx.role === "super_admin") return true;
  if (!ctx.isCustomAdmin && !isResourceEnforced("agent_draft")) return true;

  const allKey = `agent_draft.${action}.all` as PermissionKey;
  if (await hasPermission(ctx.actor, allKey)) return true;
  if (!ctx.actor.tenantCode) return false;

  return hasPermission(
    ctx.actor,
    `agent_draft.${action}.org` as PermissionKey,
    ownDraftScopes(ctx),
  );
}

export async function GET() {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  let query = db
    .from("agent_drafts")
    .select("*")
    .neq("status", "archived");

  if (ctx.role === "org_admin" && !ctx.actor.v2Loaded) {
    query = query.eq("created_by", ctx.adminId);
  }

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) {
    console.error("[agent-drafts list]", error);
    return apiError("获取列表失败", "INTERNAL_ERROR");
  }

  let rows = data ?? [];
  if (ctx.role !== "super_admin") {
    const visible = [];
    for (const row of rows) {
      const err = await requireAccess(ctx.actor, "agent_draft", "read", { id: row.id });
      if (!err) visible.push(row);
    }
    rows = visible;
  }

  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  if (ctx.role !== "super_admin") {
    const err = await requireAccess(ctx.actor, "agent_draft", "create");
    if (err) return err;
    if (
      !(await canUseCreatedDraft(ctx, "read")) ||
      !(await canUseCreatedDraft(ctx, "update"))
    ) {
      return apiError("权限不足：缺少草稿读取或编辑权限，无法新建可用草稿", "FORBIDDEN");
    }
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "未命名智能体").trim() || "未命名智能体";

  const providerId =
    typeof body.provider_id === "string" && body.provider_id.length > 0
      ? body.provider_id
      : null;
  const builderConfig: Record<string, unknown> =
    body.builder_config && typeof body.builder_config === "object"
      ? (body.builder_config as Record<string, unknown>)
      : {};
  const kbIdsRaw = builderConfig.knowledge_base_ids;
  const kbIds: string[] = Array.isArray(kbIdsRaw)
    ? (kbIdsRaw as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  if (providerId) {
    const { data: prov } = await db
      .from("model_providers")
      .select("id, tenant_code")
      .eq("id", providerId)
      .maybeSingle();
    if (!prov) return apiError("引用的供应商不存在", "VALIDATION_ERROR");
    if (!(await canReadTenantOwned(ctx, "model_provider", prov as TenantOwnedRow))) {
      return apiError("引用的供应商不存在或无权访问", "VALIDATION_ERROR");
    }
  }

  if (kbIds.length > 0) {
    const { data: kbRows } = await db
      .from("knowledge_bases")
      .select("id, tenant_code")
      .in("id", kbIds);
    const rows = (kbRows ?? []) as TenantOwnedRow[];
    const visibleIds = new Set<string>();
    for (const row of rows) {
      if (await canReadTenantOwned(ctx, "knowledge_base", row)) visibleIds.add(row.id);
    }
    const invisible = kbIds.filter((id) => !visibleIds.has(id));
    if (invisible.length > 0) {
      return apiError(
        `引用的知识库${invisible.length} 个不存在或无权访问（${invisible.slice(0, 3).join("、")}${invisible.length > 3 ? "..." : ""}）`,
        "VALIDATION_ERROR",
      );
    }
  }

  const payload = {
    name,
    description: String(body.description ?? ""),
    category_ids: Array.isArray(body.category_ids) ? body.category_ids : [],
    provider_id: providerId,
    agent_type: body.agent_type === "external" ? "external" : "chat",
    external_url: String(body.external_url ?? ""),
    builder_config: builderConfig,
    model_params: body.model_params && typeof body.model_params === "object" ? body.model_params : {},
    visibility_config:
      body.visibility_config && typeof body.visibility_config === "object"
        ? body.visibility_config
        : { visible_to: "owner_only", scope: [] },
    status: "draft" as const,
    created_by: ctx.adminId,
    updated_by: ctx.adminId,
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
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "create",
    resourceType: "agent_draft",
    resourceId: data.id,
    resourceName: name,
  });

  return NextResponse.json(data as DraftRow);
}
