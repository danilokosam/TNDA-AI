import { getAllPlans, getEffectivePlan } from "@/modules/organization/organization.service";

export async function listAvailablePlans() {
  return getAllPlans();
}

export async function getCurrentSubscription(organizationId: string) {
  const { plan, subscription } = await getEffectivePlan(organizationId);

  return {
    plan,
    subscription: subscription ?? {
      status: "active" as const,
      planId: plan.id,
      note: "No paid subscription on file; organization is on the free tier by default.",
    },
  };
}
