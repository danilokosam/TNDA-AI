import type { Metadata } from "next";
import Link from "next/link";
import { Files, LayoutDashboard, Percent, Timer } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/dashboard/StatTile";
import { CurrentPlanCard } from "@/components/dashboard/CurrentPlanCard";
import { DocumentsTrendChart } from "@/components/dashboard/DocumentsTrendChart";
import { ProcessingOutcomesChart } from "@/components/dashboard/ProcessingOutcomesChart";
import { DocumentTypeBreakdown } from "@/components/dashboard/DocumentTypeBreakdown";
import { getOrganizationOverview, getJobStats } from "@/services/organization.service";
import { getSubscription } from "@/services/billing.service";
import { listDocuments } from "@/services/documents.service";
import { formatDuration, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * A Server Component fetching directly via `services/*`, not the `/api/organization/stats`
 * etc. BFF routes built alongside these services — same precedent as `DashboardLayout`
 * (see its doc comment): nothing here needs client-side refetching yet. Those BFF routes
 * exist for Stage 5/6 and any future client-side interaction on this page.
 *
 * `listDocuments({ limit: 100 })` (100 is `GET /documents`'s max page size)
 * powers `DocumentTypeBreakdown` only — deliberately not used to recompute
 * anything `stats` already answers (completed/failed/success rate), since a
 * paginated sample and a true aggregate can disagree for an organization
 * with more than 100 documents, and this dashboard should never show two
 * different numbers for the same thing.
 */
export default async function DashboardPage() {
  const [{ usage }, stats, { plan, subscription }, recentDocuments] = await Promise.all([
    getOrganizationOverview(),
    getJobStats(),
    getSubscription(),
    listDocuments({ limit: 100 }),
  ]);

  // `stats.totalJobs` only counts terminal (completed/failed) jobs in the
  // stats window (get_organization_daily_job_counts, 0010_document_analytics.sql
  // — same WHERE clause as the stats aggregate). `usage.documentsUsed` also
  // counts pending/processing jobs in the current billing period, so an org
  // with an upload still in flight doesn't see "no documents yet" while it's
  // between "uploaded" and "resolved."
  if (stats.totalJobs === 0 && usage.documentsUsed === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Your processing activity at a glance." />
        <EmptyState
          icon={LayoutDashboard}
          title="No documents yet"
          description="Upload your first document to see processing stats here."
          action={
            <Button asChild>
              <Link href="/upload">Upload a document</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Your processing activity at a glance." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={Files}
          label="Documents processed"
          value={stats.totalJobs.toLocaleString()}
          description={`${stats.completedJobs.toLocaleString()} completed · ${stats.failedJobs.toLocaleString()} failed`}
        />
        <StatTile
          icon={Percent}
          label="Success rate"
          value={stats.successRate !== null ? formatPercent(stats.successRate) : "—"}
          description={stats.successRate === null ? "No completed jobs yet" : undefined}
        />
        <StatTile
          icon={Timer}
          label="Avg. processing time"
          value={stats.avgProcessingSeconds !== null ? formatDuration(stats.avgProcessingSeconds) : "—"}
          description={stats.avgProcessingSeconds === null ? "No completed jobs yet" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <DocumentsTrendChart className="lg:col-span-2" dailyCounts={stats.dailyCounts} />
        <CurrentPlanCard plan={plan} status={subscription.status} usage={usage} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProcessingOutcomesChart completedJobs={stats.completedJobs} failedJobs={stats.failedJobs} />
        <DocumentTypeBreakdown jobs={recentDocuments.data} hasMore={recentDocuments.pagination.hasMore} />
      </div>
    </>
  );
}
