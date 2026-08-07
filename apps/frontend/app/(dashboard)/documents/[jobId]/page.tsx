import type { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { DocumentResultsView } from "@/components/results/DocumentResultsView";

export const metadata: Metadata = { title: "Document results" };

export default async function DocumentResultsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  return (
    <>
      <PageHeader title="Document results" description="Extracted fields and processing status for this document." />
      <DocumentResultsView jobId={jobId} />
    </>
  );
}
