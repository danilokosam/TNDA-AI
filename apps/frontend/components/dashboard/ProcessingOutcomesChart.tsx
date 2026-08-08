import { PieChart } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ProcessingOutcomesChartProps {
  completedJobs: number;
  failedJobs: number;
  className?: string;
}

const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;

/**
 * A stroke-dasharray donut (two circles sharing one radius, each dashed to
 * its own share of the circumference) rather than hand-built arc `path`
 * `d` strings — the usual arc-path math has a genuine degenerate case at
 * exactly 0%/100% (start point coincides with end point, so the arc flag
 * can't determine a direction), which is exactly the shape this chart takes
 * whenever a org has only ever had completed jobs, or only ever had failed
 * ones. A dasharray of `0 circumference` (nothing drawn) or `circumference 0`
 * (a full ring) both fall out of the same formula with no special-casing.
 */
export function computeOutcomeShares(completedJobs: number, failedJobs: number) {
  const total = completedJobs + failedJobs;
  return {
    total,
    completedRatio: total > 0 ? completedJobs / total : 0,
    failedRatio: total > 0 ? failedJobs / total : 0,
  };
}

/**
 * Completed vs. failed, from the same terminal-job aggregate that already
 * powers the "Documents processed" / "Success rate" KPI tiles — not a
 * second, independently-sampled number, so it can never disagree with them.
 * Deliberately excludes `rejected_quota` jobs: those were never actually
 * attempted (quota rejected them pre-flight), so lumping them in with
 * "failed" would misrepresent a processing failure as something it wasn't.
 */
export function ProcessingOutcomesChart({ completedJobs, failedJobs, className }: ProcessingOutcomesChartProps) {
  const { total, completedRatio, failedRatio } = computeOutcomeShares(completedJobs, failedJobs);

  if (total === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Processing outcomes</CardTitle>
          <CardDescription>Completed vs. failed</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <PieChart className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No completed or failed documents yet in this window.</p>
        </CardContent>
      </Card>
    );
  }

  const completedLength = completedRatio * CIRCUMFERENCE;
  const failedLength = failedRatio * CIRCUMFERENCE;

  return (
    <Card className={cn("@container", className)}>
      <CardHeader>
        <CardTitle>Processing outcomes</CardTitle>
        <CardDescription>Completed vs. failed</CardDescription>
      </CardHeader>
      {/*
        `@sm:flex-row` (a container query, not `sm:`) — this card sits in a
        2-column grid, so its own rendered width tracks the *card*, not the
        viewport. At a viewport wide enough to be 2 columns but still
        modest (a tablet), a viewport-based `sm:flex-row` would force a row
        layout the actual card is too narrow for, overflowing the legend
        past the card edge. Confirmed live at 820px before switching to this.
        `@container` lives on `Card` (the ancestor), not this element — a
        container query variant queries an ancestor's containment, not its
        own; putting both on the same node silently never matches.
      */}
      <CardContent className="flex flex-col items-center justify-center gap-6 @sm:flex-row">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="shrink-0" aria-hidden="true">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--color-muted)" strokeWidth={STROKE} />
          {completedLength > 0 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="var(--color-success)"
              strokeWidth={STROKE}
              strokeDasharray={`${completedLength} ${CIRCUMFERENCE - completedLength}`}
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          ) : null}
          {failedLength > 0 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke="var(--color-destructive)"
              strokeWidth={STROKE}
              strokeDasharray={`${failedLength} ${CIRCUMFERENCE - failedLength}`}
              strokeDashoffset={-completedLength}
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          ) : null}
          <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="fill-foreground text-2xl font-semibold [font-variant-numeric:tabular-nums]">
            {total.toLocaleString()}
          </text>
          <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            documents
          </text>
        </svg>

        <dl className="w-full max-w-40 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-sm text-foreground">
              <span className="size-2.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
              Completed
            </dt>
            <dd className="text-sm text-muted-foreground [font-variant-numeric:tabular-nums]">
              {completedJobs.toLocaleString()} · {formatPercent(completedRatio)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-sm text-foreground">
              <span className="size-2.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
              Failed
            </dt>
            <dd className="text-sm text-muted-foreground [font-variant-numeric:tabular-nums]">
              {failedJobs.toLocaleString()} · {formatPercent(failedRatio)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
