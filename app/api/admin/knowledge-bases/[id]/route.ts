import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog, resolveResourceTenantCode } from "@/lib/audit";
import type { AdminPayload } from "@/lib/auth";
import {
  canReadRow,
  canWriteRow,
  sanitizeUpdatePatch,
  requireWriteAccess,
  validateTenantCode,
  scanReferences,
} from "@/lib/scoped-access";
// 6.4up v2 Phase D · D-5 · kb enforce（resourceKind=knowledge_base；env "knowledge_base" 启用；空时 no-op）
import { isResourceEnforced, requireAccess } from "@/lib/access-facade";

// 5.19up 知识库方案 A · PR-A3 · 知识库详情 / 更新 / 删除
// 5.30up · B 半 RBAC 改造（R2 通过）：
//   - GET：先 load → canReadRow → 404 屏蔽别 org/不存在
//          R1 §4：org_admin 不返 referencedByAgents 名单，仅返计数（防 agent 名跨组织泄漏）
//   - PATCH：requireWriteAccess + canWriteRow + sanitizeUpdatePatch
//            R2 §6：显式 tenant_code 调 validateTenantCode
//            R2 §4：转让 tenant_code 必须零引用（scanReferences）
//            R2 §5：补 writeAuditLog
//   - DELETE：requireWriteAccess + canWriteRow + scanReferences（扩展扫 draft JSON）+ 审计
//             DELETE 前先 resolveResourceTenantCode 缓存以避免审计 tenant_code 丢失

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

/** GET：知识库详情 + 文档列表 + 「被哪些智能体引用」反查 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const actor = ctx.actor;

  const { id } = await params;
  const { data: kb, error } = await db
    .from("knowledge_bases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[knowledge-bases get]", error);
    return apiError("获取知识库详情失败", "INTERNAL_ERROR");
  }
  // 5.30up · 404 屏蔽：不存在 / 不在可见范围 → 一视同仁返 404（防 id 探测枚举别 org 资源）
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");
  if (ctx.isCustomAdmin) {
    const err = await requireAccess(actor, "knowledge_base", "read", {
      row: { id, tenant_code: (kb as { tenant_code: string | null }).tenant_code },
    });
    if (err) return err;
  } else if (!canReadRow(ctx.access as AdminPayload, kb)) {
    return apiError("知识库不存在", "NOT_FOUND");
  }

  // Phase D D-5 · v2 第二闸 read（env-gated；复用已 load 的 kb row）
  if (isResourceEnforced("knowledge_base") && !ctx.isCustomAdmin && ctx.role !== "super_admin") {
    const err = await requireAccess(actor, "knowledge_base", "read", {
      row: { id, tenant_code: (kb as { tenant_code: string | null }).tenant_code },
    });
    if (err) return err;
  }

  const { data: documents, error: docErr } = await db
    .from("kb_documents")
    .select("id, kb_id, filename, file_type, status, chunk_count, total_chunks, char_count, error_msg, created_at")
    .eq("kb_id", id)
    .order("created_at", { ascending: false });
  if (docErr) {
    console.error("[knowledge-bases get] 文档列表失败", docErr);
    return apiError("获取文档列表失败", "INTERNAL_ERROR");
  }

  // 反查：被哪些智能体引用
  // 5.30up · R1 §4：org_admin 不返 agent name 列表（防 agent 名跨组织泄漏）；
  //                 仅返计数，UI 文案改为"被 N 个智能体引用（含本组织外）"
  const { data: links, error: linkErr } = await db
    .from("agent_knowledge_bases")
    .select("agent_id")
    .eq("kb_id", id);
  if (linkErr) {
    console.error("[knowledge-bases get] 引用反查失败", linkErr);
    return apiError("引用反查失败", "INTERNAL_ERROR");
  }
  const agentIds = (links ?? []).map((l: { agent_id: string }) => l.agent_id);

  if (ctx.role === "org_admin" || ctx.isCustomAdmin) {
    // 仅返计数（含本组织外）
    return NextResponse.json({
      knowledgeBase: kb,
      documents: documents ?? [],
      referencedByAgentCount: agentIds.length,
    });
  }

  // super / system → 完整名单
  let referencedByAgents: { id: string; name: string }[] = [];
  if (agentIds.length > 0) {
    const { data: agents } = await db
      .from("agents")
      .select("id, name")
      .in("id", agentIds);
    referencedByAgents = (agents ?? []) as { id: string; name: string }[];
  }

  return NextResponse.json({
    knowledgeBase: kb,
    documents: documents ?? [],
    referencedByAgents,
  });
}

/** PATCH：改名 / 改描述 / 启停 / （super/system）转让归属 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const actor = ctx.actor;

  // 5.30up · R2 §1 双闸门：角色白名单 + org_admin tenantCode 非空兜底
  if (!ctx.isCustomAdmin) {
    const gate = requireWriteAccess(ctx.access as AdminPayload, [...KB_WRITE_ROLES]);
    if (gate) return gate;
  }

  const { id } = await params;

  // 先 load row 判归属（404 屏蔽别 org / 不存在）
  const { data: existing, error: loadErr } = await db
    .from("knowledge_bases")
    .select("id, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[knowledge-bases update] load 失败", loadErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!existing) return apiError("知识库不存在", "NOT_FOUND");
  if (!ctx.isCustomAdmin && !canWriteRow(ctx.access as AdminPayload, existing)) {
    // org_admin 试图改别 org / 平台公共 → 404 屏蔽
    return apiError("知识库不存在", "NOT_FOUND");
  }

  // Phase D D-5 · v2 第二闸 update（env-gated；复用已 load 的 existing row）
  if ((ctx.isCustomAdmin || isResourceEnforced("knowledge_base")) && ctx.role !== "super_admin") {
    const err = await requireAccess(actor, "knowledge_base", "update", { row: existing });
    if (err) return err;
  }

  // 5.30up · org_admin 额外校验 admin.tenantCode 在 tenants 表存在
  if ((ctx.role === "org_admin" || ctx.isCustomAdmin) && ctx.tenantCode) {
    const ok = await validateTenantCode(ctx.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }

  const body = await req.json();
  const rawPatch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return apiError("知识库名称不能为空", "VALIDATION_ERROR");
    if (name.length > 100) return apiError("知识库名称过长（上限 100 字）", "VALIDATION_ERROR");
    rawPatch.name = name;
  }
  if (typeof body.description === "string") {
    rawPatch.description = body.description.trim();
  }
  if (typeof body.status === "string") {
    if (body.status !== "active" && body.status !== "disabled") {
      return apiError("状态只能是 active / disabled", "VALIDATION_ERROR");
    }
    rawPatch.status = body.status;
  }
  // super/system 可改 tenant_code（转让归属）；org_admin 后面会被 sanitizeUpdatePatch 剥离
  if ("tenant_code" in body) {
    const raw = body.tenant_code;
    if (raw === null) {
      rawPatch.tenant_code = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      rawPatch.tenant_code = trimmed === "" ? null : trimmed;
    } else {
      return apiError("tenant_code 字段格式错误", "VALIDATION_ERROR");
    }
  }

  // 5.30up · 剥离 org_admin 的 tenant_code（防越权转让）
  const patch = ctx.isCustomAdmin
    ? (() => {
        const { tenant_code: _stripped, ...rest } = rawPatch;
        void _stripped;
        return rest;
      })()
    : sanitizeUpdatePatch(ctx.access as AdminPayload, rawPatch);

  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }

  // 5.30up · R2 §6：super/system 转让到某 org → 先校验 tenants.code 存在性
  if (
    (ctx.role === "super_admin" || ctx.role === "system_admin") &&
    "tenant_code" in patch &&
    typeof patch.tenant_code === "string" &&
    patch.tenant_code !== existing.tenant_code
  ) {
    const ok = await validateTenantCode(patch.tenant_code as string);
    if (!ok) {
      return apiError(
        `目标组织代码「${patch.tenant_code}」不存在或已失效`,
        "VALIDATION_ERROR"
      );
    }
  }

  // 5.30up · R2 §4：转让 tenant_code 必须零引用（含 NULL→某 org / 某 org→NULL / 某 org→另一 org）
  if ("tenant_code" in patch && patch.tenant_code !== existing.tenant_code) {
    const refs = await scanReferences("knowledge_base", id);
    if (refs.totalCount > 0) {
      return apiError(
        `知识库被 ${refs.totalCount} 处引用（${refs.byPlace.join(" / ")}），转让前请先解绑`,
        "VALIDATION_ERROR"
      );
    }
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("knowledge_bases")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[knowledge-bases update]", error);
    return apiError("更新知识库失败", "INTERNAL_ERROR");
  }

  // 5.30up · R2 §5 · 补审计（原 KB PATCH 路由无审计）
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode,
    resourceTenantCode: (data as { tenant_code: string | null }).tenant_code,
    action: "update",
    resourceType: "knowledge_base",
    resourceId: id,
    resourceName: (data as { name: string }).name,
    detail: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  });

  return NextResponse.json(data);
}

/** DELETE：删除知识库。被智能体引用时阻止（避免静默解绑）。文档 / 切片由 FK 级联删除。 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const actor = ctx.actor;

  // 5.30up · R2 §1 双闸门
  if (!ctx.isCustomAdmin) {
    const gate = requireWriteAccess(ctx.access as AdminPayload, [...KB_WRITE_ROLES]);
    if (gate) return gate;
  }

  const { id } = await params;

  // 先 load row 判归属
  const { data: existing, error: loadErr } = await db
    .from("knowledge_bases")
    .select("id, name, tenant_code")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    console.error("[knowledge-bases delete] load 失败", loadErr);
    return apiError("加载知识库失败", "INTERNAL_ERROR");
  }
  if (!existing) return apiError("知识库不存在", "NOT_FOUND");
  if (!ctx.isCustomAdmin && !canWriteRow(ctx.access as AdminPayload, existing)) {
    return apiError("知识库不存在", "NOT_FOUND");
  }

  // Phase D D-5 · v2 第二闸 delete（env-gated；复用已 load 的 existing row）
  if ((ctx.isCustomAdmin || isResourceEnforced("knowledge_base")) && ctx.role !== "super_admin") {
    const err = await requireAccess(actor, "knowledge_base", "delete", { row: existing });
    if (err) return err;
  }

  // 5.30up · org_admin 额外校验 admin.tenantCode 在 tenants 表存在
  if ((ctx.role === "org_admin" || ctx.isCustomAdmin) && ctx.tenantCode) {
    const ok = await validateTenantCode(ctx.tenantCode);
    if (!ok) return apiError("您所属的组织不存在或已失效，请联系平台管理员", "FORBIDDEN");
  }

  // 5.30up · R2 §4 · 引用扫描：原 KB DELETE 只扫 agent_knowledge_bases，扩展为 scanReferences
  //                （含 agent_knowledge_bases + agent_drafts.builder_config.knowledge_base_ids JSON）
  const refs = await scanReferences("knowledge_base", id);
  if (refs.totalCount > 0) {
    return apiError(
      `该知识库被 ${refs.totalCount} 处引用（${refs.byPlace.join(" / ")}），请先在搭建器解除绑定`,
      "VALIDATION_ERROR"
    );
  }

  // 5.30up · R2 §5 · DELETE 前先缓存 tenant_code（删除后反查就拿不到了）
  const cachedTenantCode = await resolveResourceTenantCode("knowledge_base", id);

  // 删除存储里的文档文件（DB 行由 FK 级联删除）
  const { data: docs } = await db
    .from("kb_documents")
    .select("storage_path")
    .eq("kb_id", id);
  const paths = ((docs ?? []) as { storage_path: string }[])
    .map((d) => d.storage_path)
    .filter(Boolean);
  if (paths.length > 0) {
    const { error: rmErr } = await db.storage.from("uploads").remove(paths);
    if (rmErr) console.error("[knowledge-bases delete] 清理存储文件失败（不阻断）", rmErr);
  }

  const { error } = await db.from("knowledge_bases").delete().eq("id", id);
  if (error) {
    console.error("[knowledge-bases delete]", error);
    return apiError("删除知识库失败", "INTERNAL_ERROR");
  }

  // 5.30up · R2 §5 · 补审计
  await writeAuditLog({
    adminId: ctx.adminId,
    adminUsername: ctx.username,
    adminRole: ctx.role,
    adminTenantCode: ctx.tenantCode,
    resourceTenantCode: cachedTenantCode,
    action: "delete",
    resourceType: "knowledge_base",
    resourceId: id,
    resourceName: existing.name,
    detail: {},
  });

  return NextResponse.json({ ok: true });
}
