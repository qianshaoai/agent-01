/**
 * 6.3up R1.1 · 工作流分层级配置 · 导航树
 *
 * 返回 tenants → departments → teams 嵌套结构，供 /admin/workflow-config 左侧三栏导航使用。
 *
 * 权限：isWorkflowConfigAdmin = super_admin + system_admin（决策点 3）。
 */

import { dbError, apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { requireAdminActor } from "@/lib/session";
import { db } from "@/lib/db";
import {
  getWorkflowConfigScope,
  requireWorkflowConfigAccess,
} from "@/lib/workflow-admin-access";

type Team = { id: string; name: string; dept_id: string; sort_order: number | null };
type Dept = { id: string; name: string; tenant_code: string; sort_order: number | null; teams: Team[] };
type Tenant = { code: string; name: string; enabled: boolean; departments: Dept[] };

export async function GET() {
  const ctx = await requireAdminActor();
  if (ctx instanceof Response) return ctx;
  const accessErr = await requireWorkflowConfigAccess(ctx);
  if (accessErr) return accessErr;
  const allowedScope = await getWorkflowConfigScope(ctx.actor);
  if (!allowedScope) return apiError("无权访问工作流配置", "FORBIDDEN");

  const [{ data: tenants, error: te }, { data: depts, error: de }, { data: teams, error: tme }] = await Promise.all([
    db.from("tenants").select("code, name, enabled").order("code"),
    db.from("departments").select("id, name, tenant_code, sort_order").order("sort_order").order("name"),
    db.from("teams").select("id, name, dept_id, sort_order").order("sort_order").order("name"),
  ]);
  if (te) return dbError(te);
  if (de) return dbError(de);
  if (tme) return dbError(tme);

  let tenantRows = (tenants ?? []) as { code: string; name: string; enabled: boolean }[];
  let deptRows = (depts ?? []) as Omit<Dept, "teams">[];
  let teamRows = (teams ?? []) as Team[];

  if (!allowedScope.all) {
    if (allowedScope.org) {
      tenantRows = tenantRows.filter((t) => t.code === allowedScope.org);
      deptRows = deptRows.filter((d) => d.tenant_code === allowedScope.org);
      const deptIds = new Set(deptRows.map((d) => d.id));
      teamRows = teamRows.filter((t) => deptIds.has(t.dept_id));
    } else if (allowedScope.dept) {
      deptRows = deptRows.filter((d) => d.id === allowedScope.dept);
      const tenantCodes = new Set(deptRows.map((d) => d.tenant_code));
      tenantRows = tenantRows.filter((t) => tenantCodes.has(t.code));
      teamRows = teamRows.filter((t) => t.dept_id === allowedScope.dept);
    } else if (allowedScope.team) {
      teamRows = teamRows.filter((t) => t.id === allowedScope.team);
      const deptIds = new Set(teamRows.map((t) => t.dept_id));
      deptRows = deptRows.filter((d) => deptIds.has(d.id));
      const tenantCodes = new Set(deptRows.map((d) => d.tenant_code));
      tenantRows = tenantRows.filter((t) => tenantCodes.has(t.code));
    }
  }

  const teamsByDept = new Map<string, Team[]>();
  for (const t of teamRows) {
    const arr = teamsByDept.get(t.dept_id) ?? [];
    arr.push(t);
    teamsByDept.set(t.dept_id, arr);
  }

  const deptsByTenant = new Map<string, Dept[]>();
  for (const d of deptRows) {
    const arr = deptsByTenant.get(d.tenant_code) ?? [];
    arr.push({ ...d, teams: teamsByDept.get(d.id) ?? [] });
    deptsByTenant.set(d.tenant_code, arr);
  }

  const tree: Tenant[] = tenantRows.map((t) => ({
    code: t.code,
    name: t.name,
    enabled: t.enabled,
    departments: deptsByTenant.get(t.code) ?? [],
  }));

  return NextResponse.json(tree);
}
