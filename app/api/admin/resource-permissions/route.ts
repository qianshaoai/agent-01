import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getScopeLabel(scopeType: string, scopeId: string | null, maps: any) {
  switch (scopeType) {
    case "all": return "全部用户";
    case "user_type": return scopeId === "personal" ? "个人用户" : "组织用户";
    case "org": return maps.tenant[scopeId ?? ""] ? `${maps.tenant[scopeId ?? ""]} (${scopeId})` : (scopeId ?? "");
    case "dept": return maps.dept[scopeId ?? ""] ?? scopeId ?? "";
    case "team": return maps.team[scopeId ?? ""] ?? scopeId ?? "";
    case "user": return maps.user[scopeId ?? ""] ?? scopeId ?? "";
    case "group": return maps.group[scopeId ?? ""] ?? scopeId ?? "";
    default: return scopeId ?? "";
  }
}

export async function GET(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { searchParams } = req.nextUrl;
  const resourceType = searchParams.get("resource_type");
  const resourceId = searchParams.get("resource_id");
  const scopeType = searchParams.get("scope_type");
  const scopeId = searchParams.get("scope_id");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = db.from("resource_permissions").select("*") as any;
  if (resourceType) query = query.eq("resource_type", resourceType);
  if (resourceId) query = query.eq("resource_id", resourceId);
  if (scopeType) query = query.eq("scope_type", scopeType);
  if (scopeId) query = query.eq("scope_id", scopeId);

  const { data, error } = await query;
  if (error) return dbError(error);

  const perms = data ?? [];

  // Batch fetch display labels
  const orgCodes  = [...new Set(perms.filter((p: { scope_type: string; scope_id: string }) => p.scope_type === "org").map((p: { scope_id: string }) => p.scope_id).filter(Boolean))] as string[];
  const deptIds   = [...new Set(perms.filter((p: { scope_type: string; scope_id: string }) => p.scope_type === "dept").map((p: { scope_id: string }) => p.scope_id).filter(Boolean))] as string[];
  const teamIds   = [...new Set(perms.filter((p: { scope_type: string; scope_id: string }) => p.scope_type === "team").map((p: { scope_id: string }) => p.scope_id).filter(Boolean))] as string[];
  const userIds   = [...new Set(perms.filter((p: { scope_type: string; scope_id: string }) => p.scope_type === "user").map((p: { scope_id: string }) => p.scope_id).filter(Boolean))] as string[];
  const groupIds  = [...new Set(perms.filter((p: { scope_type: string; scope_id: string }) => p.scope_type === "group").map((p: { scope_id: string }) => p.scope_id).filter(Boolean))] as string[];

  const [tenantRes, deptRes, teamRes, userRes, groupRes] = await Promise.all([
    orgCodes.length  > 0 ? db.from("tenants").select("code, name").in("code", orgCodes)          : Promise.resolve({ data: [] }),
    deptIds.length   > 0 ? db.from("departments").select("id, name").in("id", deptIds)           : Promise.resolve({ data: [] }),
    teamIds.length   > 0 ? db.from("teams").select("id, name").in("id", teamIds)                 : Promise.resolve({ data: [] }),
    userIds.length   > 0 ? db.from("users").select("id, nickname").in("id", userIds)             : Promise.resolve({ data: [] }),
    groupIds.length  > 0 ? db.from("user_groups").select("id, name").in("id", groupIds)          : Promise.resolve({ data: [] }),
  ]);

  const maps = {
    tenant: Object.fromEntries((tenantRes.data ?? []).map((t: { code: string; name: string }) => [t.code, t.name])),
    dept:   Object.fromEntries((deptRes.data  ?? []).map((d: { id: string; name: string })   => [d.id, d.name])),
    team:   Object.fromEntries((teamRes.data  ?? []).map((t: { id: string; name: string })   => [t.id, t.name])),
    user:   Object.fromEntries((userRes.data  ?? []).map((u: { id: string; nickname: string }) => [u.id, u.nickname])),
    group:  Object.fromEntries((groupRes.data ?? []).map((g: { id: string; name: string })   => [g.id, g.name])),
  };

  const enriched = perms.map((p: { scope_type: string; scope_id: string | null }) => ({
    ...p,
    scope_label: getScopeLabel(p.scope_type, p.scope_id, maps),
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { resourceType, resourceId, scopeType, scopeId } = await req.json();
  if (!resourceType || !resourceId || !scopeType) {
    return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
  }

  const { data, error } = await db
    .from("resource_permissions")
    .insert({ resource_type: resourceType, resource_id: resourceId, scope_type: scopeType, scope_id: scopeId ?? null })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "该权限已存在" }, { status: 409 });
    return dbError(error);
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { id } = await req.json();
  const { error } = await db.from("resource_permissions").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
