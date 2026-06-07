/**
 * 6.3up R1.1 · 工作流分层级配置 · 排序 CRUD（同步写 resource_permissions）
 *
 * 路径 P1（小B R1.1 拍板）：管理员"拉取"工作流到层级 = 同步写两张表：
 *   - workflow_scope_order：管该层级"排序"
 *   - resource_permissions：管该层级"可见"
 *
 * 权限：isWorkflowConfigAdmin = super_admin + system_admin（决策点 3）。
 *
 * scope 校验（小B R1 finding 4）：
 *   - org / dept / team 的 scope_id 必须真实存在
 *   - UI 三栏选择天然保证 dept 属于所选 org、team 属于所选 dept；API 只接收最终 scope
 *
 * 批量重排走 RPC `batch_reorder_workflow_scope`（事务化 DELETE + INSERT，避主键冲突）。
 *
 * 每个写操作都写一条 workflow_scope_order 审计；POST/DELETE 的 permission 同步在 RPC 内原子完成。
 */

import { dbError, apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireAccess } from "@/lib/access-facade";
import { requireWorkflowScopeAccess } from "@/lib/workflow-admin-access";

type ScopeType = "org" | "dept" | "team";

function isValidScopeType(s: string | null): s is ScopeType {
  return s === "org" || s === "dept" || s === "team";
}

/** 校验最终 scope_id 存在；层级归属由左侧三栏选择产生的 scope 保证。 */
async function validateScopeId(scopeType: ScopeType, scopeId: string): Promise<{ ok: true } | { ok: false; msg: string }> {
  if (scopeType === "org") {
    const { data } = await db.from("tenants").select("code").eq("code", scopeId).maybeSingle();
    if (!data) return { ok: false, msg: `组织 ${scopeId} 不存在` };
    return { ok: true };
  }
  if (scopeType === "dept") {
    const { data } = await db.from("departments").select("id, tenant_code").eq("id", scopeId).maybeSingle();
    if (!data) return { ok: false, msg: "部门不存在" };
    return { ok: true };
  }
  // team
  const { data } = await db.from("teams").select("id, dept_id, tenant_code").eq("id", scopeId).maybeSingle();
  if (!data) return { ok: false, msg: "小组不存在" };
  return { ok: true };
}

// ── GET ?scope_type=X&scope_id=Y → 该 scope 已配置的工作流（含 sort_order）─────
export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const sp = req.nextUrl.searchParams;
  const scopeType = sp.get("scope_type");
  const scopeId = sp.get("scope_id");
  if (!isValidScopeType(scopeType) || !scopeId) {
    return apiError("scope_type / scope_id 必填", "VALIDATION_ERROR");
  }
  const accessErr = await requireWorkflowScopeAccess(ctx, "read", scopeType, scopeId);
  if (accessErr) return accessErr;

  const { data: orderRows, error } = await db
    .from("workflow_scope_order")
    .select("workflow_id, sort_order")
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .order("sort_order", { ascending: true });
  if (error) return dbError(error);

  const orderArr = (orderRows ?? []) as { workflow_id: string; sort_order: number }[];
  if (orderArr.length === 0) {
    return NextResponse.json([]);
  }
  const ids = orderArr.map((r) => r.workflow_id);
  const { data: wfRows } = await db
    .from("workflows")
    .select("id, name, description, enabled, visible_to, sort_order")
    .in("id", ids);
  const wfMap = new Map<string, { id: string; name: string; description: string | null; enabled: boolean; visible_to: string | null; sort_order: number | null }>();
  for (const w of (wfRows ?? []) as { id: string; name: string; description: string | null; enabled: boolean; visible_to: string | null; sort_order: number | null }[]) {
    wfMap.set(w.id, w);
  }
  const enriched = orderArr.map((r) => {
    const wf = wfMap.get(r.workflow_id);
    return {
      workflow_id: r.workflow_id,
      sort_order: r.sort_order,
      name: wf?.name ?? "(已删除)",
      description: wf?.description ?? "",
      enabled: wf?.enabled ?? false,
      visible_to: wf?.visible_to ?? null,
      missing: !wf,
    };
  });
  return NextResponse.json(enriched);
}

// ── POST {scope_type, scope_id, workflowIds[]} → 批量"拉取"（同步写两张表）──
export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const body = await req.json().catch(() => ({}));
  const scopeType = body.scope_type as string | undefined;
  const scopeId = body.scope_id as string | undefined;
  const workflowIds = body.workflowIds as string[] | undefined;
  if (!isValidScopeType(scopeType ?? null) || !scopeId || !Array.isArray(workflowIds) || workflowIds.length === 0) {
    return apiError("scope_type / scope_id / workflowIds 必填", "VALIDATION_ERROR");
  }
  const st = scopeType as ScopeType;

  // R1.4 Finding 1 修复：与 PUT 同口径做去重校验。
  //   route 层不去重的话，请求体里 [A, A] 会让 v47 RPC 的 `INSERT ... NOT EXISTS` 同时
  //   通过两次（同一 SELECT 看不到本事务已 INSERT 的 A），随后撞 workflow_scope_order 主键
  //   导致整个事务回滚 + 返回 500。UI 用 Set 不会触发，但 curl / 集成测试 / SDK 调用会。
  if (new Set(workflowIds).size !== workflowIds.length) {
    return apiError("workflowIds 含重复工作流 id", "VALIDATION_ERROR");
  }

  const scopeCheck = await validateScopeId(st, scopeId);
  if (!scopeCheck.ok) return apiError(scopeCheck.msg, "VALIDATION_ERROR");
  const accessErr = await requireWorkflowScopeAccess(ctx, "update", st, scopeId);
  if (accessErr) return accessErr;

  // 校验所有 workflowIds 都存在 + 不是 personal_only
  // R1.2 Finding 3 修复：personal_only 工作流被 helper 在 visible_to 短路时直接拒，
  // 写进 org/dept/team 的 order + permissions 实际不会被组织用户看到，是 dead config。
  const { data: existRows } = await db
    .from("workflows")
    .select("id, name, visible_to")
    .in("id", workflowIds);
  const existSet = new Set(((existRows ?? []) as { id: string; name: string; visible_to: string | null }[]).map((r) => r.id));
  const missing = workflowIds.filter((id) => !existSet.has(id));
  if (missing.length > 0) {
    return apiError(`工作流不存在：${missing.join(", ")}`, "VALIDATION_ERROR");
  }
  const personalOnly = ((existRows ?? []) as { id: string; name: string; visible_to: string | null }[])
    .filter((r) => r.visible_to === "personal_only");
  if (personalOnly.length > 0) {
    const names = personalOnly.map((r) => r.name).join("、");
    return apiError(
      `个人工作流不能配置到组织/部门/小组层级：${names}（可见范围请先改为「全部 / 仅组织 / 自定义」）`,
      "VALIDATION_ERROR"
    );
  }
  for (const workflowId of workflowIds) {
    const readErr = await requireAccess(ctx.actor, "workflow", "read", { id: workflowId });
    if (readErr) return readErr;
  }

  // R1.2 Finding 4 修复：把"写 order + 写 permissions"封进 v47 RPC `add_workflow_scope_order`，
  //   PL/pgSQL 内 CTE 单事务、幂等跳过已存在；避免 route 层分两步写产生"半成功"竞态。
  const { data: addedCount, error: rpcErr } = await db.rpc("add_workflow_scope_order", {
    p_scope_type: st,
    p_scope_id: scopeId,
    p_workflow_ids: workflowIds,
  });
  if (rpcErr) return dbError(rpcErr);
  const added = Number(addedCount ?? 0);
  const skipped = workflowIds.length - added;

  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode ?? null,
    action: "create", resourceType: "workflow_scope_order",
    resourceName: `${st}/${scopeId}`,
    detail: { scope_type: st, scope_id: scopeId, workflow_ids: workflowIds, added, skipped },
  });

  return NextResponse.json({ ok: true, added, skipped }, { status: 201 });
}

// ── PUT {scope_type, scope_id, orderedIds[]} → 批量重排（事务）──────────────
export async function PUT(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const body = await req.json().catch(() => ({}));
  const scopeType = body.scope_type as string | undefined;
  const scopeId = body.scope_id as string | undefined;
  const orderedIds = body.orderedIds as string[] | undefined;
  if (!isValidScopeType(scopeType ?? null) || !scopeId || !Array.isArray(orderedIds)) {
    return apiError("scope_type / scope_id / orderedIds 必填", "VALIDATION_ERROR");
  }
  const st = scopeType as ScopeType;

  const scopeCheck = await validateScopeId(st, scopeId);
  if (!scopeCheck.ok) return apiError(scopeCheck.msg, "VALIDATION_ERROR");
  const accessErr = await requireWorkflowScopeAccess(ctx, "update", st, scopeId);
  if (accessErr) return accessErr;

  // R1.3 Finding 2 修复：校验 orderedIds 必须正好是该 scope 当前已配置的工作流集合（仅顺序不同）。
  // 旧版直接把 orderedIds 交给 batch_reorder_workflow_scope 重写 order，
  // 而该 RPC 不写 resource_permissions —— 直接调 API 塞进"不在当前 scope 但 workflow 存在"的 id，
  // 就会绕过 POST 的双表写入，制造"有排序无可见"状态。
  // 设计：PUT 仅承担"重排"职责；新增走 POST，移除走 DELETE。集合不等即拒。
  const { data: currentRows, error: curErr } = await db
    .from("workflow_scope_order")
    .select("workflow_id")
    .eq("scope_type", st)
    .eq("scope_id", scopeId);
  if (curErr) return dbError(curErr);
  const currentSet = new Set(((currentRows ?? []) as { workflow_id: string }[]).map((r) => r.workflow_id));
  const incomingSet = new Set(orderedIds);
  // 长度等价检查（用于检测重复）：incomingSet.size 必须 = orderedIds.length
  if (incomingSet.size !== orderedIds.length) {
    return apiError("orderedIds 含重复工作流 id", "VALIDATION_ERROR");
  }
  if (currentSet.size !== incomingSet.size) {
    return apiError(
      `orderedIds 必须正好是该层级当前已配置工作流的重排（当前 ${currentSet.size} 个，传入 ${incomingSet.size} 个）；新增请用 POST，移除请用 DELETE`,
      "VALIDATION_ERROR"
    );
  }
  const extra = [...incomingSet].filter((id) => !currentSet.has(id));
  const missing = [...currentSet].filter((id) => !incomingSet.has(id));
  if (extra.length > 0 || missing.length > 0) {
    return apiError(
      `orderedIds 与该层级当前已配置工作流不匹配（多出 ${extra.length} 个 / 缺失 ${missing.length} 个）；新增请用 POST，移除请用 DELETE`,
      "VALIDATION_ERROR"
    );
  }

  // 调 RPC：事务内 DELETE + INSERT，避免主键冲突
  const { error } = await db.rpc("batch_reorder_workflow_scope", {
    p_scope_type: st,
    p_scope_id: scopeId,
    p_ordered_ids: orderedIds,
  });
  if (error) return dbError(error);

  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode ?? null,
    action: "update", resourceType: "workflow_scope_order",
    resourceName: `${st}/${scopeId}`,
    detail: { scope_type: st, scope_id: scopeId, ordered_ids: orderedIds, count: orderedIds.length },
  });

  return NextResponse.json({ ok: true, count: orderedIds.length });
}

// ── DELETE {scope_type, scope_id, workflowId} → 同步删 order + permissions ──
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const body = await req.json().catch(() => ({}));
  const scopeType = body.scope_type as string | undefined;
  const scopeId = body.scope_id as string | undefined;
  const workflowId = body.workflowId as string | undefined;
  if (!isValidScopeType(scopeType ?? null) || !scopeId || !workflowId) {
    return apiError("scope_type / scope_id / workflowId 必填", "VALIDATION_ERROR");
  }
  const st = scopeType as ScopeType;
  const accessErr = await requireWorkflowScopeAccess(ctx, "update", st, scopeId);
  if (accessErr) return accessErr;

  // R1.2 Finding 4 修复：DELETE 也封进 v47 RPC `remove_workflow_scope_order`，
  //   PL/pgSQL 内单事务同步删 order + permissions，幂等。
  const { error: rpcErr } = await db.rpc("remove_workflow_scope_order", {
    p_scope_type: st,
    p_scope_id: scopeId,
    p_workflow_id: workflowId,
  });
  if (rpcErr) return dbError(rpcErr);

  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode ?? null,
    action: "delete", resourceType: "workflow_scope_order",
    resourceName: `${st}/${scopeId}`,
    detail: { scope_type: st, scope_id: scopeId, workflow_id: workflowId },
  });

  return NextResponse.json({ ok: true });
}
