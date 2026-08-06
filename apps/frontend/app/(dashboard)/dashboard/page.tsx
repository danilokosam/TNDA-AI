import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Your processing activity at a glance." />
      <EmptyState
        icon={LayoutDashboard}
        title="Dashboard is being built next"
        description="Usage, subscription status, and processing stats will appear here."
      />
    </>
  );
}
