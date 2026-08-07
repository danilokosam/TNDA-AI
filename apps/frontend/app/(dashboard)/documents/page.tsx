import type { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { DocumentsWorkspace } from "@/components/documents/DocumentsWorkspace";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <>
      <PageHeader title="Documents" description="Processing history for your organization." />
      <DocumentsWorkspace />
    </>
  );
}
