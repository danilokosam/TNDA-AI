import type { Metadata } from "next";
import { can } from "@tnda-ai/shared";
import { PageHeader } from "@/components/common/PageHeader";
import { DocumentsWorkspace } from "@/components/documents/DocumentsWorkspace";
import { getCurrentUser } from "@/services/auth.service";

export const metadata: Metadata = { title: "Documents" };

/**
 * Fetches `role` server-side and passes down a plain `canExport` boolean —
 * same pattern as `BillingPage`'s own doc comment: nothing here needs a
 * client-side refetch of the current user yet, and there's no
 * `/api/auth/me` BFF route to fetch it from on the client anyway.
 */
export default async function DocumentsPage() {
  const { role } = await getCurrentUser();
  const canExport = can(role, "documents.export");

  return (
    <>
      <PageHeader title="Documents" description="Processing history for your organization." />
      <DocumentsWorkspace canExport={canExport} />
    </>
  );
}
