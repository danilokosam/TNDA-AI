import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import { organizationOverviewSchema, type OrganizationOverview } from "@/types/api";

/**
 * `{organization, usage}` — a strict superset of the backend's separate
 * `/organizations/me/usage` endpoint, so that one is never called from
 * this app at all (one fewer route/service/hook for zero functional loss).
 */
export async function getOrganizationOverview(): Promise<OrganizationOverview> {
  const accessToken = await getAccessToken();
  return backendFetch("/api/v1/organizations/me", organizationOverviewSchema, {
    accessToken: accessToken ?? undefined,
  });
}
