import { supabaseAdmin } from "@/config/supabase";
import { AppError, NotFoundError } from "@/utils/errors";
import type { Database } from "@/config/database.types";

function assertNoQueryError(error: { message: string } | null): void {
  if (error) {
    throw new AppError(500, "INTERNAL_ERROR", error.message);
  }
}

export type PlanRow = Database["public"]["Tables"]["plans"]["Row"];
export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
export type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];

export async function getOrganizationById(organizationId: string): Promise<OrganizationRow> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, name, created_at")
    .eq("id", organizationId)
    .single();

  if (error || !data) {
    throw new NotFoundError("Organization not found.");
  }

  return data;
}

/** The organization's current paid subscription, or `null` if it has none (implicit free tier). */
export async function getActiveSubscription(organizationId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id, organization_id, plan_id, status, current_period_start, current_period_end, created_at")
    .eq("organization_id", organizationId)
    .in("status", ["trialing", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoQueryError(error);

  return data;
}

export async function getPlanById(planId: string): Promise<PlanRow> {
  const { data, error } = await supabaseAdmin.from("plans").select("*").eq("id", planId).single();

  if (error || !data) {
    throw new NotFoundError(`Plan "${planId}" does not exist.`);
  }

  return data;
}

export async function listPlans(): Promise<PlanRow[]> {
  const { data, error } = await supabaseAdmin.from("plans").select("*").order("price_monthly", { ascending: true });

  assertNoQueryError(error);

  return data ?? [];
}

/** Sum of pages consumed by the organization within its current billing period. */
export async function getMonthlyPagesUsed(organizationId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("get_organization_monthly_usage", {
    p_organization_id: organizationId,
  });

  assertNoQueryError(error);

  return data ?? 0;
}

/** Count of jobs (pending/processing/completed) submitted since `periodStart`. */
export async function getDocumentsSubmittedSince(organizationId: string, periodStart: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("document_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", periodStart)
    .in("status", ["pending", "processing", "completed"]);

  assertNoQueryError(error);

  return count ?? 0;
}
