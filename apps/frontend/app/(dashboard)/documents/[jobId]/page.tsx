import type { Metadata } from "next";
import { can } from "@tnda-ai/shared";
import { PageHeader } from "@/components/common/PageHeader";
import { DocumentResultsView } from "@/components/results/DocumentResultsView";
import { getCurrentUser } from "@/services/auth.service";

export const metadata: Metadata = { title: "Document results" };

/**
 * Fetches `role` server-side and passes down a plain `canReview` boolean —
 * same pattern as `BillingPage`'s own doc comment: nothing here needs a
 * client-side refetch of the current user yet, and there's no
 * `/api/auth/me` BFF route to fetch it from on the client anyway.
 */
export default async function DocumentResultsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { role } = await getCurrentUser();
  const canReview = can(role, "documents.review");

  return (
    <>
      <PageHeader title="Document results" description="Extracted fields and processing status for this document." />
      <DocumentResultsView jobId={jobId} canReview={canReview} />
    </>
  );
}
