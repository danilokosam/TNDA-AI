import { Suspense } from "react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { BillingWorkspace } from "@/components/billing/BillingWorkspace";
import { getCurrentUser } from "@/services/auth.service";

export const metadata: Metadata = { title: "Billing" };

/**
 * Fetches `role` server-side and passes it down as a prop — same rationale
 * as `DashboardLayout`'s own doc comment: nothing here needs a client-side
 * refetch of the current user yet, and there's no `/api/auth/me` BFF route
 * to fetch it from on the client anyway.
 *
 * `BillingWorkspace` reads `?checkout=success|cancelled` via
 * `useSearchParams()`, which Next.js requires a `<Suspense>` boundary
 * around (otherwise the route can't be statically prerendered).
 */
export default async function BillingPage() {
  const { role } = await getCurrentUser();

  return (
    <>
      <PageHeader title="Billing" description="Plan, usage, and subscription management." />
      <Suspense fallback={null}>
        <BillingWorkspace role={role} />
      </Suspense>
    </>
  );
}
