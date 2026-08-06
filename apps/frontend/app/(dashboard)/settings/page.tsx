import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Organization details and preferences." />
      <EmptyState
        icon={Settings}
        title="Settings is coming soon"
        description="Organization info, role, and usage/quota details will live here."
      />
    </>
  );
}
