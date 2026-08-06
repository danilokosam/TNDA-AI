import type { Metadata } from "next";
import { FileClock } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <>
      <PageHeader title="Documents" description="Processing history for your organization." />
      <EmptyState
        icon={FileClock}
        title="Document history is coming soon"
        description="A searchable, filterable, paginated list of every processed document will live here."
      />
    </>
  );
}
