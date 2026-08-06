import type { Metadata } from "next";
import { FileUp } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <>
      <PageHeader title="Upload" description="Process a new document or batch of documents." />
      <EmptyState
        icon={FileUp}
        title="Upload is coming soon"
        description="Drag-and-drop, document type selection, and progress tracking will live here."
      />
    </>
  );
}
