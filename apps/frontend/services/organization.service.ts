import "server-only";
import { backendFetch } from "@/lib/api/backend-client";
import { getAccessToken } from "@/lib/supabase/server-client";
import { organizationOverviewSchema, organizationStatsSchema, type OrganizationOverview, type OrganizationStats } from "@/types/api";

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

/**
 * `since` must be an ISO datetime string when provided (the backend bounds
 * it to the last 400 days and rejects a future date) — the backend defaults
 * to a 30-day trailing window when omitted, matched here by not sending it.
 */
export async function getJobStats(since?: string): Promise<OrganizationStats> {
  const accessToken = await getAccessToken();
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return backendFetch(`/api/v1/organizations/me/stats${query}`, organizationStatsSchema, {
    accessToken: accessToken ?? undefined,
  });
}
