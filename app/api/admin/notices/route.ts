import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
// 6.4up v2 Phase C · enforce 叠加（env "notice" 启用时生效；空时完全 no-op）
// R1：notice 的 POST 因业务转换（org_admin 强制 / 全局-vs-组织）不走 facade，直接 hasPermission
// R3：POST 改为 OR-check（.all || .org），修 R1 在 finalTenantCode != null 时漏 .all 兜底的窄分支
import { hasPermission } from "@/lib/permission-actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  // Phase C HC2 · list 走 env-gated hasPermission 粗粒度 check（不走 requireAccess 因为没 row）
  // 任一 scope 通过即放行；旧 org_admin filter 继续叠加（保留全局公告可见性）
  if (ctx.role !== "super_admin") {
    const okOrg = ctx.tenantCode
      ? await hasPermission(ctx.actor, "notice.read.org", [
          { scope_type: "org", scope_id: ctx.tenantCode },
        ])
      : false;
    const okAll = await hasPermission(ctx.actor, "notice.read.all");
    if (!okOrg && !okAll) return apiError("权限不足", "FORBIDDEN");
  }

  const { page, pageSize, start } = parsePagination(req, 50);
  let query = db
    .from("notices")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  // 组织管理员只能看自己组织的公告 + 全局公告
  if (ctx.role !== "super_admin" && !(await hasPermission(ctx.actor, "notice.read.all"))) {
    if (!ctx.tenantCode) return paginatedResponse([], 0, page, pageSize);
    query = query.eq("tenant_code", ctx.tenantCode);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);
  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const { tenantCode, content } = await req.json();
  if (!content?.trim()) {
    return apiError("公告内容不能为空", "VALIDATION_ERROR");
  }

  // 业务转换：org_admin 强制只能发自己组织的公告，禁止全局公告
  // 必须在 v2 enforce 之前算 finalTenantCode（v2 判定要按"最终归属"而非请求体）
  let finalTenantCode = tenantCode?.trim().toUpperCase() || null;
  const okAllCreate = await hasPermission(ctx.actor, "notice.create.all");
  if ((ctx.role === "org_admin" || ctx.isCustomAdmin) && !okAllCreate) {
    if (!ctx.tenantCode) return apiError("你没有关联组织", "FORBIDDEN");
    finalTenantCode = ctx.tenantCode;
  }

  // Phase C R3 · v2 第二闸 create（env-gated；OR-check 双形态，与 HC2 GET list 同款）
  //   背景：R1 把 create 拆成 finalTenantCode 双分支，但 finalTenantCode != null 时
  //         只查 .org —— 而 v2 lib isScopeWithinActorRange 对 .org + actor.tenantCode=null
  //         直接返回 false（permission-actor.ts:452-455），导致 sys（无 tenantCode）
  //         哪怕 v52 同时给了 .all 和 .org，也会被 .org scope 校验误拒。Phase C R2 dev
  //         smoke 行 4 抓到此点。
  //   修：先算 okAll；finalTenantCode != null 时 okAll || .org（OR 兜底）。
  //   语义："actor 有 .all → 任何形态都允许；否则再看 .org 是否覆盖目标 org"。
  //   不动 v2 lib，不动 adapter，不动 seed —— R3 仅 route 层一处。
  if (ctx.role !== "super_admin") {
    const okAll = okAllCreate;
    const ok = finalTenantCode === null
      ? okAll
      : okAll || await hasPermission(ctx.actor, "notice.create.org", [
          { scope_type: "org", scope_id: finalTenantCode },
        ]);
    if (!ok) return apiError("权限不足", "FORBIDDEN");
  }

  const { data, error } = await db
    .from("notices")
    .insert({
      tenant_code: finalTenantCode,
      content: content.trim(),
      enabled: true,
    })
    .select()
    .single();

  if (error) return dbError(error);
  await writeAuditLog({
    adminId: ctx.adminId, adminUsername: ctx.username, adminRole: ctx.role, adminTenantCode: ctx.tenantCode,
    action: "create", resourceType: "notice", resourceId: data.id,
    resourceName: data.content?.slice(0, 50),
    detail: { tenant_code: finalTenantCode },
  });
  return NextResponse.json(data, { status: 201 });
}
