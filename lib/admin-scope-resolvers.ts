import { db } from "@/lib/db";
import type { ResourceScope } from "@/lib/permission-actor";
import { scopesFromTenantCode } from "@/lib/adapters/access/_scope-utils";

type CreatorTenantRow = { id: string; tenant_code: string | null };
type DraftOwnerRow = { id: string; created_by: string | null };

export async function resolveAdminOrUserTenantCode(
  actorId: string | null | undefined,
): Promise<string | null> {
  if (!actorId) return null;

  const [{ data: adminCreator }, { data: userCreator }] = await Promise.all([
    db.from("admins").select("tenant_code").eq("id", actorId).maybeSingle(),
    db.from("users").select("tenant_code").eq("id", actorId).maybeSingle(),
  ]);

  return (
    (adminCreator?.tenant_code as string | null | undefined) ??
    (userCreator?.tenant_code as string | null | undefined) ??
    null
  );
}

export async function resolveAgentDraftOwnerScopesById(
  draftId: string | null | undefined,
): Promise<ResourceScope[] | null> {
  if (!draftId) return null;

  const { data: draft } = await db
    .from("agent_drafts")
    .select("id, created_by")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return null;

  const tenantCode = await resolveAdminOrUserTenantCode(
    (draft as DraftOwnerRow).created_by,
  );
  return scopesFromTenantCode(tenantCode);
}

export async function resolveAgentDraftOwnerScopesMap(
  draftIds: string[],
): Promise<Map<string, ResourceScope[]>> {
  const ids = [...new Set(draftIds.filter(Boolean))];
  const out = new Map<string, ResourceScope[]>();
  if (ids.length === 0) return out;

  const { data: drafts } = await db
    .from("agent_drafts")
    .select("id, created_by")
    .in("id", ids);
  const draftRows = (drafts ?? []) as DraftOwnerRow[];
  const creatorIds = [
    ...new Set(
      draftRows
        .map((row) => row.created_by)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const tenantByCreator = new Map<string, string | null>();
  if (creatorIds.length > 0) {
    const [{ data: admins }, { data: users }] = await Promise.all([
      db.from("admins").select("id, tenant_code").in("id", creatorIds),
      db.from("users").select("id, tenant_code").in("id", creatorIds),
    ]);

    for (const row of (users ?? []) as CreatorTenantRow[]) {
      tenantByCreator.set(row.id, row.tenant_code ?? null);
    }
    for (const row of (admins ?? []) as CreatorTenantRow[]) {
      tenantByCreator.set(row.id, row.tenant_code ?? null);
    }
  }

  for (const row of draftRows) {
    const tenantCode = row.created_by
      ? tenantByCreator.get(row.created_by) ?? null
      : null;
    out.set(row.id, scopesFromTenantCode(tenantCode));
  }
  return out;
}
