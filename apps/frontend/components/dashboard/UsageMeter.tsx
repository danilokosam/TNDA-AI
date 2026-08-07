import { cn } from "@/lib/utils";

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
}

/**
 * "A single ratio against a limit" (dataviz skill's choosing-a-form.md) is a
 * meter, not a stat tile or a chart. Fill carries severity — this app has no
 * dedicated "warning" token yet (only `--destructive` for errors), so the
 * meter uses a deliberately simple two-step severity (normal / at-quota)
 * rather than inventing a three-step accent/warning/danger ramp for one
 * component.
 */
export function UsageMeter({ label, used, limit }: UsageMeterProps) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const isNearLimit = ratio >= 0.9;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.min(used, limit)}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={`${used.toLocaleString()} of ${limit.toLocaleString()} used`}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", isNearLimit ? "bg-destructive" : "bg-[var(--color-chart-1)]")}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
