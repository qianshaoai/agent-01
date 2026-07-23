import { NextRequest, NextResponse } from "next/server";
import { apiError, dbError } from "@/lib/api-error";
import { db } from "@/lib/db";
import {
  markRequestAuth,
  markRequestBusiness,
  withRequestLog,
} from "@/lib/request-logger";
import { requireAdminActor } from "@/lib/session";
import { resolveOrgTreeAccess } from "@/lib/admin-org-tree-access";

export const dynamic = "force-dynamic";

type TenantRow = { id: string; code: string; name: string; enabled: boolean };
type DepartmentRow = {
  id: string;
  name: string;
  tenant_code: string;
  sort_order: number | null;
};
type TeamRow = {
  id: string;
  name: string;
  dept_id: string;
  tenant_code: string | null;
  sort_order: number | null;
};

async function getOrgTree(req: NextRequest) {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  markRequestAuth(req, { source: ctx.source, role: ctx.role });

  const purpose = req.nextUrl.searchParams.get("purpose") ?? "picker";
  if (purpose !== "picker") {
    return apiError("不支持的组织树用途", "VALIDATION_ERROR");
  }

  const permissionKeys = new Set<string>([
    ...ctx.actor.permissions,
    ...ctx.actor.effectivePermissions,
  ]);
  const access = resolveOrgTreeAccess({
    role: ctx.role,
    permissionKeys,
    tenantCode: ctx.tenantCode,
    deptId: ctx.actor.deptId,
    teamId: ctx.actor.teamId,
  });
  if (access.kind === "deny") {
    return apiError("无权读取组织参考数据", "FORBIDDEN");
  }
  const canReadAll = access.kind === "all";

  const [
    { data: tenantData, error: tenantError },
    { data: departmentData, error: departmentError },
    { data: teamData, error: teamError },
  ] = await Promise.all([
    db.from("tenants").select("id, code, name, enabled").order("code"),
    db
      .from("departments")
      .select("id, name, tenant_code, sort_order")
      .order("sort_order")
      .order("name"),
    db
      .from("teams")
      .select("id, name, dept_id, tenant_code, sort_order")
      .order("sort_order")
      .order("name"),
  ]);
  if (tenantError) return dbError(tenantError);
  if (departmentError) return dbError(departmentError);
  if (teamError) return dbError(teamError);

  let tenants = (tenantData ?? []) as TenantRow[];
  let departments = (departmentData ?? []) as DepartmentRow[];
  let teams = (teamData ?? []) as TeamRow[];

  if (!canReadAll) {
    if (access.kind === "team") {
      teams = teams.filter((team) => team.id === access.id);
      const deptIds = new Set(teams.map((team) => team.dept_id));
      departments = departments.filter((dept) => deptIds.has(dept.id));
    } else if (access.kind === "dept") {
      departments = departments.filter((dept) => dept.id === access.id);
      teams = teams.filter((team) => team.dept_id === access.id);
    } else if (access.kind === "org") {
      departments = departments.filter(
        (dept) => dept.tenant_code === access.id,
      );
      const deptIds = new Set(departments.map((dept) => dept.id));
      teams = teams.filter((team) => deptIds.has(team.dept_id));
    }

    const tenantCodes = new Set(departments.map((dept) => dept.tenant_code));
    tenants = tenants.filter((tenant) => tenantCodes.has(tenant.code));
  }

  markRequestBusiness(req);
  return NextResponse.json({ tenants, departments, teams });
}

export const GET = withRequestLog(getOrgTree);
