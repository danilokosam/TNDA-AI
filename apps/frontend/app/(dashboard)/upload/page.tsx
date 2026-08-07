import type { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { UploadWorkspace } from "@/components/upload/UploadWorkspace";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <>
      <PageHeader title="Upload" description="Process a new document or batch of documents." />
      <UploadWorkspace />
    </>
  );
}
