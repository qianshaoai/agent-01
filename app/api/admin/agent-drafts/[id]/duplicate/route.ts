import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor, type AdminActorContext } from "@/lib/session";
import type { AdminPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { canReadRow } from "@/lib/scoped-access";
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";
import { hasPermission, type ResourceScope } from "@/lib/permission-actor";
import type { PermissionKey } from "@/lib/permission-keys";

// 5.14up PR-B · 复制草稿
// 复制所有字段，但：
//   - name 后缀加 "（副本）"
//   - status 重置为 'draft'
//   - published_agent_id 置 null（副本是独立的）
//   - source_agent_id 沿用原值
//   - created_by / updated_by 设为当前管理员
//
// 5.30up · R1 §2 · 草稿引用资源 RBAC 校验（**软降级口径**）
//   复制是"拿别人的模板改造"高频路径（如复制平台 demo agent），硬阻断会破坏体验。
//   口径：
//   - 源 provider_id 当前 admin 不可见 → 设为 NULL（admin 后续自己选）
//   - 源 KB ids 当前 admin 不可见 → 从 array 移除
//   - 返回 strippedIds: { provider, kbs } 让前端 toast 提示哪些被剥离

type DraftRow = {
  id: string;
  name: string;
  description: string;
  category_ids: unknown[];
  provider_id: string | null;
  agent_type: string;
  external_url: string;
  builder_config: Record<string, unknown>;
  model_params: Record<string, unknown>;
  visibility_config: Record<string, unknown>;
  source_agent_id: string | null;
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

function shouldEnforceDraftPermissions(ctx: AdminActorContext): boolean {
  return ctx.isCustomAdmin || isResourceEnforced("agent_draft");
}

function ownDraftScopes(ctx: AdminActorContext): ResourceScope[] {
  return ctx.actor.tenantCode
    ? [{ scope_type: "org", scope_id: ctx.actor.tenantCode }]
    : [{ scope_type: "all", scope_id: null }];
}

async function hasOwnDraftAction(
  ctx: AdminActorContext,
  action: "read" | "update" | "duplicate",
): Promise<boolean> {
  if (ctx.role === "super_admin") return true;
  if (!shouldEnforceDraftPermissions(ctx)) return true;

  const allKey = `agent_draft.${action}.all` as PermissionKey;
  if (await hasPermission(ctx.actor, allKey)) return true;
  if (!ctx.actor.tenantCode) return false;

  return hasPermission(
    ctx.actor,
    `agent_draft.${action}.org` as PermissionKey,
    ownDraftScopes(ctx),
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { id } = await params;
  const { data: src, error: loadError } = await db
    .from("agent_drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    console.error("[agent-drafts duplicate load]", loadError);
    return apiError("加载源草稿失败", "INTERNAL_ERROR");
  }
  if (!src) return apiError("源草稿不存在", "NOT_FOUND");
  // 5.19up · org_admin 只能复制自己创建的草稿
  // 5.30up R4 #2 · 放宽：org_admin 也可复制 super/system 创建的草稿（视为"平台模板/demo"）
  //   方案 R1 §2 软降级语义要求 —— 复制 demo agent 是高频路径；不可见的 provider/KB 已由
  //   下方剥离机制托底。但仍禁止复制别 org_admin 的草稿（隐私 + 越权）。
  if (ctx.isCustomAdmin) {
    const err = await requireAccess(ctx.actor, "agent_draft", "read", { id });
    if (err) return err;
  } else if (ctx.role === "org_admin" && !ctx.actor.v2Loaded) {
    const srcCreatedBy = (src as { created_by?: string }).created_by;
    if (srcCreatedBy !== ctx.adminId) {
      // 查 created_by 的角色：先 admins 表，再 users 表（5.28up · 后台账号可能在 users 表）
      let creatorRole: string | null = null;
      const { data: a1 } = await db
        .from("admins").select("role").eq("id", srcCreatedBy).maybeSingle();
      if (a1?.role) creatorRole = a1.role;
      else {
        const { data: u1 } = await db
          .from("users").select("role").eq("id", srcCreatedBy).maybeSingle();
        if (u1?.role) creatorRole = u1.role;
      }
      if (creatorRole !== "super_admin" && creatorRole !== "system_admin") {
        return apiError("无权复制该草稿", "FORBIDDEN");
      }
    }
  }

  // Phase D D-2 · v2 第二闸 duplicate（env-gated）：按 actor 自身 duplicate 能力判（OR .all/.org），
  //   不按 source scope —— source 可能是 super/system 的平台模板（all scope），用 source scope 会误拒
  //   org_admin 复制模板（5.30up R4 放权）。上方 source 创建者角色检查仍限制可复制的源。
  if (ctx.role !== "super_admin" && !(await hasOwnDraftAction(ctx, "duplicate"))) {
    return apiError("权限不足", "FORBIDDEN");
  }
  if (ctx.role !== "super_admin") {
    if (
      !(await hasOwnDraftAction(ctx, "read")) ||
      !(await hasOwnDraftAction(ctx, "update"))
    ) {
      return apiError("权限不足：缺少草稿读取或编辑权限，无法复制为可用草稿", "FORBIDDEN");
    }
  }

  const source = src as DraftRow;

  // 5.30up · R1 §2 软降级：源 provider_id / KB ids 按当前 admin 视角校验，不可见的剥离
  let effProviderId = source.provider_id;
  let strippedProvider: string | null = null;
  if (effProviderId) {
    const { data: prov } = await db
      .from("model_providers")
      .select("id, tenant_code")
      .eq("id", effProviderId)
      .maybeSingle();
    if (!prov || !(await canReadTenantOwned(ctx, "model_provider", prov as TenantOwnedRow))) {
      strippedProvider = effProviderId;
      effProviderId = null;
    }
  }

  const srcBuilderConfig = (source.builder_config ?? {}) as Record<string, unknown>;
  const srcKbIdsRaw = srcBuilderConfig.knowledge_base_ids;
  const srcKbIds: string[] = Array.isArray(srcKbIdsRaw)
    ? (srcKbIdsRaw as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  let visibleKbIds = srcKbIds;
  const strippedKbs: string[] = [];
  if (srcKbIds.length > 0) {
    const { data: kbRows } = await db
      .from("knowledge_bases")
      .select("id, tenant_code")
      .in("id", srcKbIds);
    const rows = (kbRows ?? []) as { id: string; tenant_code: string | null }[];
    const visibleSet = new Set<string>();
    for (const row of rows) {
      if (await canReadTenantOwned(ctx, "knowledge_base", row)) visibleSet.add(row.id);
    }
    visibleKbIds = srcKbIds.filter((kid) => visibleSet.has(kid));
    for (const kid of srcKbIds) if (!visibleSet.has(kid)) strippedKbs.push(kid);
  }

  // 重组 builder_config：原配置不动，只覆盖 knowledge_base_ids（可能被过滤）
  const effBuilderConfig: Record<string, unknown> = {
    ...srcBuilderConfig,
    ...(srcKbIds.length > 0 ? { knowledge_base_ids: visibleKbIds } : {}),
  };

  const payload = {
    name: `${source.name}（副本）`,
    description: source.description,
    category_ids: source.category_ids,
    provider_id: effProviderId,
    agent_type: source.agent_type,
    external_url: source.external_url,
    builder_config: effBuilderConfig,
    model_params: source.model_params,
    visibility_config: source.visibility_config,
    status: "draft" as const,
    source_agent_id: source.source_agent_id,
    published_agent_id: null,
    created_by: ctx.adminId,
    updated_by: ctx.adminId,
  };

  const { data, error } = await db
    .from("agent_drafts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("[agent-drafts duplicate insert]", error);
    return apiError("复制草稿失败", "INTERNAL_ERROR");
  }

  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode ?? null,
    action: "create",
    resourceType: "agent_draft",
    resourceId: data.id,
    resourceName: payload.name,
    detail: {
      duplicated_from: id,
      stripped_provider: strippedProvider,
      stripped_kbs: strippedKbs,
    },
  });

  // 5.30up · 返回 strippedIds 供前端 toast 提示
  return NextResponse.json({
    ...data,
    strippedIds: { provider: strippedProvider, kbs: strippedKbs },
  });
}
