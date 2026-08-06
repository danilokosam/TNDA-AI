import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <>
      <PageHeader title="Billing" description="Plan, usage, and subscription management." />
      <EmptyState
        icon={CreditCard}
        title="Billing is coming soon"
        description="Plan comparison, upgrade flow, and the billing portal will live here."
      />
    </>
  );
}
