import { apiError, dbError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permission-actor";
import { requireAdminActor } from "@/lib/session";
import { NextRequest, NextResponse } from "next/server";

type Team = { id: string; name: string; dept_id: string; sort_order: number | null };
type Dept = {
  id: string;
  name: string;
  tenant_code: string;
  sort_order: number | null;
  teams: Team[];
};
type Tenant = { code: string; name: string; enabled: boolean; departments: Dept[] };

export async function GET(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;

  const action = req.nextUrl.searchParams.get("purpose") === "create" ? "create" : "update";
  const canUseAll =
    ctx.role === "super_admin" ||
    (ctx.role === "system_admin" && !ctx.isCustomAdmin) ||
    (await hasPermission(ctx.actor, `kb.${action}.all`));
  const canUseScoped =
    canUseAll ||
    (await hasPermission(ctx.actor, `kb.${action}.org`)) ||
    (ctx.role === "org_admin" && !ctx.isCustomAdmin);

  if (!canUseScoped) return apiError("权限不足", "FORBIDDEN");
  if (!canUseAll && !ctx.tenantCode) {
    return NextResponse.json({ canUseAll: false, tree: [] });
  }

  const [{ data: tenants, error: te }, { data: depts, error: de }, { data: teams, error: tme }] =
    await Promise.all([
      db.from("tenants").select("code, name, enabled").order("code"),
      db.from("departments").select("id, name, tenant_code, sort_order").order("sort_order").order("name"),
      db.from("teams").select("id, name, dept_id, tenant_code, sort_order").order("sort_order").order("name"),
    ]);
  if (te) return dbError(te);
  if (de) return dbError(de);
  if (tme) return dbError(tme);

  let tenantRows = (tenants ?? []) as { code: string; name: string; enabled: boolean }[];
  let deptRows = (depts ?? []) as Omit<Dept, "teams">[];
  let teamRows = (teams ?? []) as Array<Team & { tenant_code?: string | null }>;

  if (!canUseAll) {
    const tenantCode = ctx.tenantCode as string;
    tenantRows = tenantRows.filter((t) => t.code === tenantCode);
    deptRows = deptRows.filter((d) => d.tenant_code === tenantCode);
    const deptIds = new Set(deptRows.map((d) => d.id));
    teamRows = teamRows.filter((t) => deptIds.has(t.dept_id));
  }

  const teamsByDept = new Map<string, Team[]>();
  for (const team of teamRows) {
    const arr = teamsByDept.get(team.dept_id) ?? [];
    arr.push({
      id: team.id,
      name: team.name,
      dept_id: team.dept_id,
      sort_order: team.sort_order,
    });
    teamsByDept.set(team.dept_id, arr);
  }

  const deptsByTenant = new Map<string, Dept[]>();
  for (const dept of deptRows) {
    const arr = deptsByTenant.get(dept.tenant_code) ?? [];
    arr.push({ ...dept, teams: teamsByDept.get(dept.id) ?? [] });
    deptsByTenant.set(dept.tenant_code, arr);
  }

  const tree: Tenant[] = tenantRows.map((tenant) => ({
    ...tenant,
    departments: deptsByTenant.get(tenant.code) ?? [],
  }));

  return NextResponse.json({ canUseAll, tree });
}
