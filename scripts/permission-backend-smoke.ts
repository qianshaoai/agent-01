import {
  ADMIN_PERMISSION_KEYS,
  CUSTOM_ROLE_PERMISSION_KEYS,
  KEYS_BY_RESOURCE,
} from "../lib/permission-keys/admin";
import {
  isCustomRolePermissionKey,
  isPermissionKey,
  isWorkflowPermissionKey,
} from "../lib/permission-keys";

let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
    return;
  }
  failed++;
  console.error(`FAIL ${label}${detail ? ` - ${detail}` : ""}`);
}

async function main() {
  check(
    "custom roles use the full admin key set",
    CUSTOM_ROLE_PERMISSION_KEYS.length === ADMIN_PERMISSION_KEYS.length &&
      CUSTOM_ROLE_PERMISSION_KEYS.every((k, i) => k === ADMIN_PERMISSION_KEYS[i]),
    `${CUSTOM_ROLE_PERMISSION_KEYS.length} keys`,
  );
  check("custom role accepts kb.read.org", isCustomRolePermissionKey("kb.read.org"));
  check("custom role accepts provider.update.org", isCustomRolePermissionKey("provider.update.org"));
  check("custom role accepts user_group.update.org", isCustomRolePermissionKey("user_group.update.org"));
  check("workflow-only guard does not accept kb.read.org", !isWorkflowPermissionKey("kb.read.org"));
  check("invalid key remains rejected", !isPermissionKey("not_a_permission.key"));
  check("user_group key group has 8 keys", (KEYS_BY_RESOURCE.user_group ?? []).length === 8);
  check("all admin keys are globally valid", ADMIN_PERMISSION_KEYS.every((k) => isPermissionKey(k)));

  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "permission-backend-smoke-placeholder";
  const { isResourceEnforced } = await import("../lib/access-facade");

  delete process.env.PERMISSION_V2_ENFORCE_RESOURCES;
  check("enforce flag defaults to all", isResourceEnforced("knowledge_base"));
  process.env.PERMISSION_V2_ENFORCE_RESOURCES = "all";
  check("enforce flag all enables workflow", isResourceEnforced("workflow"));
  process.env.PERMISSION_V2_ENFORCE_RESOURCES = "none";
  check("enforce flag none disables builtin resource gate", !isResourceEnforced("workflow"));
  process.env.PERMISSION_V2_ENFORCE_RESOURCES = "workflow,agent";
  check("enforce flag CSV enables listed resource", isResourceEnforced("workflow"));
  check("enforce flag CSV leaves unlisted resource disabled", !isResourceEnforced("knowledge_base"));

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[permission-backend-smoke] unexpected error", e);
  process.exit(1);
});
