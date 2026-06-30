import type { AdminPayload, UserPayload } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/access-facade";
import { canReadRow } from "@/lib/scoped-access";
import type { AdminActorContext } from "@/lib/session";
import { hasPermission, type PermissionActor, type ResourceScope } from "@/lib/permission-actor";
import type { PermissionKey } from "@/lib/permission-keys";

export type KbVisibilityScope = ResourceScope;
export type KbVisibilityScopeType = KbVisibilityScope["scope_type"];

type TenantOwnedKbRow = { id: string; tenant_code: string | null };
type RawScopeRow = { scope_type: string; scope_id: string | null };

const KB_RESOURCE_TYPE = "knowledge_base";
const KB_SCOPE_TYPES = new Set(["all", "org", "dept", "team"]);

function keyOf(scope: KbVisibilityScope): string {
  return `${scope.scope_type}:${scope.scope_id ?? ""}`;
}

function fallbackScopesFromTenant(tenantCode: string | null | undefined): KbVisibilityScope[] {
  return tenantCode
    ? [{ scope_type: "org", scope_id: tenantCode }]
    : [{ scope_type: "all", scope_id: null }];
}

function mapRowsToKbScopes(rows: RawScopeRow[]): KbVisibilityScope[] {
  const out: KbVisibilityScope[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!KB_SCOPE_TYPES.has(row.scope_type)) continue;
    const scope: KbVisibilityScope =
      row.scope_type === "all"
        ? { scope_type: "all", scope_id: null }
        : {
            scope_type: row.scope_type as Exclude<KbVisibilityScopeType, "all">,
            scope_id: row.scope_id,
          };
    const key = keyOf(scope);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(scope);
    }
  }
  return out;
}

export async function loadExplicitKbVisibilityScopes(kbId: string): Promise<KbVisibilityScope[]> {
  const { data, error } = await db
    .from("resource_permissions")
    .select("scope_type, scope_id")
    .eq("resource_type", KB_RESOURCE_TYPE)
    .eq("resource_id", kbId);
  if (error) {
    throw new Error(`读取知识库可见范围失败：${error.message}`);
  }
  return mapRowsToKbScopes((data ?? []) as RawScopeRow[]);
}

export async function loadEffectiveKbVisibilityScopes(
  kbId: string,
  tenantCode: string | null | undefined,
): Promise<KbVisibilityScope[]> {
  const explicit = await loadExplicitKbVisibilityScopes(kbId);
  return explicit.length > 0 ? explicit : fallbackScopesFromTenant(tenantCode);
}

export async function replaceKbVisibilityScopes(
  kbId: string,
  scopes: KbVisibilityScope[],
): Promise<void> {
  const { error: delErr } = await db
    .from("resource_permissions")
    .delete()
    .eq("resource_type", KB_RESOURCE_TYPE)
    .eq("resource_id", kbId);
  if (delErr) throw new Error(`清理旧可见范围失败：${delErr.message}`);

  if (scopes.length === 0) return;
  const rows = scopes.map((scope) => ({
    resource_type: KB_RESOURCE_TYPE,
    resource_id: kbId,
    scope_type: scope.scope_type,
    scope_id: scope.scope_type === "all" ? null : scope.scope_id,
  }));
  const { error: insErr } = await db.from("resource_permissions").insert(rows);
  if (insErr) throw new Error(`保存可见范围失败：${insErr.message}`);
}

async function scopeTenantCode(scope: KbVisibilityScope): Promise<string | null> {
  if (scope.scope_type === "all") return null;
  if (scope.scope_type === "org") return scope.scope_id;
  if (!scope.scope_id) return null;
  if (scope.scope_type === "dept") {
    const { data } = await db
      .from("departments")
      .select("tenant_code")
      .eq("id", scope.scope_id)
      .maybeSingle();
    return (data as { tenant_code?: string } | null)?.tenant_code ?? null;
  }
  const { data } = await db
    .from("teams")
    .select("tenant_code")
    .eq("id", scope.scope_id)
    .maybeSingle();
  return (data as { tenant_code?: string } | null)?.tenant_code ?? null;
}

async function actorHasAnyKbPermission(
  actor: PermissionActor,
  action: "read" | "update",
  scopes?: KbVisibilityScope[],
): Promise<boolean> {
  for (const suffix of ["all", "org"] as const) {
    const key = `kb.${action}.${suffix}` as PermissionKey;
    if (await hasPermission(actor, key, scopes)) return true;
  }
  return false;
}

async function canActorSetVisibilityScope(
  ctx: AdminActorContext,
  scope: KbVisibilityScope,
  action: "create" | "update" = "update",
): Promise<boolean> {
  if (ctx.role === "super_admin") return true;

  if (scope.scope_type === "all") {
    if (ctx.role === "system_admin" && !ctx.isCustomAdmin) return true;
    return hasPermission(ctx.actor, `kb.${action}.all` as PermissionKey);
  }

  if (await hasPermission(ctx.actor, `kb.${action}.all` as PermissionKey, [scope])) return true;
  if (await hasPermission(ctx.actor, `kb.${action}.org` as PermissionKey, [scope])) return true;

  // 兼容旧内置 org_admin 写路径：v2 未启用时 hasPermission 对 kb.* 不会放行。
  if (ctx.role === "org_admin" && !ctx.isCustomAdmin && ctx.tenantCode) {
    const tenantCode = await scopeTenantCode(scope);
    return tenantCode === ctx.tenantCode;
  }
  return false;
}

async function assertScopeExists(scope: KbVisibilityScope): Promise<string | null> {
  if (scope.scope_type === "all") return null;
  if (!scope.scope_id) return "指定范围缺少 scope_id";

  if (scope.scope_type === "org") {
    const { data } = await db
      .from("tenants")
      .select("code")
      .eq("code", scope.scope_id)
      .maybeSingle();
    return data ? null : `组织「${scope.scope_id}」不存在或已失效`;
  }
  if (scope.scope_type === "dept") {
    const { data } = await db
      .from("departments")
      .select("id")
      .eq("id", scope.scope_id)
      .maybeSingle();
    return data ? null : `部门「${scope.scope_id}」不存在`;
  }
  const { data } = await db
    .from("teams")
    .select("id")
    .eq("id", scope.scope_id)
    .maybeSingle();
  return data ? null : `小组「${scope.scope_id}」不存在`;
}

export async function normalizeKbVisibilityInputForAdmin(
  ctx: AdminActorContext,
  input: unknown,
  action: "create" | "update" = "update",
): Promise<{ ok: true; scopes: KbVisibilityScope[] } | { ok: false; error: string }> {
  if (!Array.isArray(input)) {
    return { ok: false, error: "可见范围格式错误" };
  }
  const scopes: KbVisibilityScope[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "可见范围格式错误" };
    }
    const raw = item as { scope_type?: unknown; scope_id?: unknown };
    if (raw.scope_type === "all") {
      const scope: KbVisibilityScope = { scope_type: "all", scope_id: null };
      const key = keyOf(scope);
      if (!seen.has(key)) {
        seen.add(key);
        scopes.push(scope);
      }
      continue;
    }
    if (raw.scope_type !== "org" && raw.scope_type !== "dept" && raw.scope_type !== "team") {
      return { ok: false, error: "可见范围只支持全部、组织、部门或小组" };
    }
    if (typeof raw.scope_id !== "string" || raw.scope_id.trim() === "") {
      return { ok: false, error: "指定范围缺少 scope_id" };
    }
    const scope: KbVisibilityScope = {
      scope_type: raw.scope_type,
      scope_id: raw.scope_id.trim(),
    };
    const key = keyOf(scope);
    if (!seen.has(key)) {
      seen.add(key);
      scopes.push(scope);
    }
  }

  if (scopes.length === 0) return { ok: false, error: "请至少选择一个可见范围" };
  if (scopes.some((s) => s.scope_type === "all") && scopes.length > 1) {
    return { ok: false, error: "全部可见不能和指定范围同时选择" };
  }

  for (const scope of scopes) {
    const existErr = await assertScopeExists(scope);
    if (existErr) return { ok: false, error: existErr };
    if (!(await canActorSetVisibilityScope(ctx, scope, action))) {
      return { ok: false, error: "无权设置超出当前账号范围的可见范围" };
    }
  }

  return { ok: true, scopes };
}

export async function canAdminUseKnowledgeBase(
  ctx: AdminActorContext,
  row: TenantOwnedKbRow,
): Promise<boolean> {
  if (ctx.isCustomAdmin) {
    const err = await requireAccess(ctx.actor, "knowledge_base", "read", { row });
    if (err) return false;
  } else if (!canReadRow(ctx.access as AdminPayload, row)) {
    return false;
  }

  const explicit = await loadExplicitKbVisibilityScopes(row.id);
  if (explicit.length === 0) return true;
  if (ctx.role === "super_admin" || (ctx.role === "system_admin" && !ctx.isCustomAdmin)) {
    return true;
  }

  for (const scope of explicit) {
    if (scope.scope_type === "all") {
      if (ctx.role === "org_admin" && !ctx.isCustomAdmin) return true;
      if (await actorHasAnyKbPermission(ctx.actor, "read")) return true;
    } else if (await actorHasAnyKbPermission(ctx.actor, "read", [scope])) {
      return true;
    } else if (ctx.role === "org_admin" && !ctx.isCustomAdmin && ctx.tenantCode) {
      const tenantCode = await scopeTenantCode(scope);
      if (tenantCode === ctx.tenantCode) return true;
    }
  }
  return false;
}

type UserKbCtx = {
  userId: string;
  tenantCode: string | null;
  isPersonal: boolean;
  deptId: string | null;
  teamId: string | null;
};

async function buildUserKbCtx(user: UserPayload): Promise<UserKbCtx> {
  if (user.isPersonal) {
    return {
      userId: user.userId,
      tenantCode: user.tenantCode ?? null,
      isPersonal: true,
      deptId: null,
      teamId: null,
    };
  }
  const { data } = await db
    .from("users")
    .select("tenant_code, dept_id, team_id")
    .eq("id", user.userId)
    .maybeSingle();
  const row = data as { tenant_code: string | null; dept_id: string | null; team_id: string | null } | null;
  return {
    userId: user.userId,
    tenantCode: row?.tenant_code ?? user.tenantCode ?? null,
    isPersonal: false,
    deptId: row?.dept_id ?? null,
    teamId: row?.team_id ?? null,
  };
}

function userMatchesScope(ctx: UserKbCtx, scope: KbVisibilityScope): boolean {
  if (scope.scope_type === "all") return true;
  if (ctx.isPersonal) return false;
  if (scope.scope_type === "org") return !!ctx.tenantCode && scope.scope_id === ctx.tenantCode;
  if (scope.scope_type === "dept") return !!ctx.deptId && scope.scope_id === ctx.deptId;
  if (scope.scope_type === "team") return !!ctx.teamId && scope.scope_id === ctx.teamId;
  return false;
}

export async function filterKbIdsForUserVisibility(
  user: UserPayload,
  kbIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(kbIds.filter((x) => typeof x === "string" && x))];
  if (uniqueIds.length === 0) return [];

  const [{ data: kbRows, error: kbErr }, { data: permRows, error: permErr }, userCtx] = await Promise.all([
    db.from("knowledge_bases").select("id, tenant_code").in("id", uniqueIds),
    db
      .from("resource_permissions")
      .select("resource_id, scope_type, scope_id")
      .eq("resource_type", KB_RESOURCE_TYPE)
      .in("resource_id", uniqueIds),
    buildUserKbCtx(user),
  ]);
  if (kbErr || permErr) {
    console.warn("[kb/visibility] 过滤用户可见 KB 失败，已按安全策略跳过本轮 KB", kbErr?.message ?? permErr?.message);
    return [];
  }

  const explicitByKb = new Map<string, KbVisibilityScope[]>();
  for (const row of (permRows ?? []) as Array<{ resource_id: string; scope_type: string; scope_id: string | null }>) {
    const scopes = explicitByKb.get(row.resource_id) ?? [];
    explicitByKb.set(row.resource_id, scopes);
    scopes.push(...mapRowsToKbScopes([{ scope_type: row.scope_type, scope_id: row.scope_id }]));
  }

  const kbById = new Map(
    ((kbRows ?? []) as TenantOwnedKbRow[]).map((row) => [row.id, row]),
  );
  return uniqueIds.filter((id) => {
    const row = kbById.get(id);
    if (!row) return false;
    const explicit = explicitByKb.get(id) ?? [];
    const scopes = explicit.length > 0 ? explicit : fallbackScopesFromTenant(row.tenant_code);
    return scopes.some((scope) => userMatchesScope(userCtx, scope));
  });
}
