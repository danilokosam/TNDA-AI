import { Layers } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { DOCUMENT_TYPE_LABELS } from "@/components/upload/DocumentTypeSelect";
import { formatPercent } from "@/lib/format";
import { DOCUMENT_TYPES, type DocumentType } from "@/types/api";

interface DocumentTypeBreakdownProps {
  /** Whatever page of recent documents the caller already fetched — this component only ever reads `documentType` off each one. */
  jobs: Array<{ documentType: DocumentType }>;
  /** Whether `jobs` is a partial page of a longer history (`pagination.hasMore` from `GET /documents`) — changes the card's own description so it never claims to be a complete, all-time total when it isn't. */
  hasMore: boolean;
  className?: string;
}

/** One CSS chart token per type, in `DOCUMENT_TYPES`' own fixed order — a type keeps the same color across renders and over time, regardless of which types happen to be present or how the list is sorted for display. */
const TYPE_COLOR_VAR: Record<DocumentType, string> = {
  invoice: "var(--color-chart-1)",
  receipt: "var(--color-chart-2)",
  identity_document: "var(--color-chart-3)",
  generic: "var(--color-chart-4)",
};

export interface DocumentTypeCount {
  type: DocumentType;
  count: number;
}

/** Zero-count types are dropped (nothing useful to show a customer who's never uploaded an identity document), and the rest sorted by count descending — most common type first, the standard "top categories" reading order. */
export function countByType(jobs: Array<{ documentType: DocumentType }>): DocumentTypeCount[] {
  const counts = new Map<DocumentType, number>();
  for (const job of jobs) {
    counts.set(job.documentType, (counts.get(job.documentType) ?? 0) + 1);
  }
  return DOCUMENT_TYPES.map((type) => ({ type, count: counts.get(type) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * `jobs` is a bounded page (`GET /documents`'s max `limit` is 100), not
 * every document the organization has ever submitted — a Pro-tier customer
 * near their 1,000/month quota could easily have more history than that.
 * The card's description says so explicitly (`hasMore`) rather than
 * silently presenting a partial sample as a complete distribution.
 */
export function DocumentTypeBreakdown({ jobs, hasMore, className }: DocumentTypeBreakdownProps) {
  const counts = countByType(jobs);
  const total = jobs.length;

  if (total === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Document types</CardTitle>
          <CardDescription>Recent documents</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Layers className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Document types</CardTitle>
        <CardDescription>{hasMore ? `Your ${total.toLocaleString()} most recent documents` : "All documents"}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-52 flex-col justify-center gap-4">
        {counts.map(({ type, count }) => {
          const ratio = count / total;
          return (
            <div key={type} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-foreground">{DOCUMENT_TYPE_LABELS[type]}</span>
                <span className="text-muted-foreground [font-variant-numeric:tabular-nums]">
                  {count.toLocaleString()} · {formatPercent(ratio)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, backgroundColor: TYPE_COLOR_VAR[type] }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
