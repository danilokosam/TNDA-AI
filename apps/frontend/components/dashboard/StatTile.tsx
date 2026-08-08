import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatTileProps {
  label: string;
  value: string;
  description?: ReactNode;
  icon?: LucideIcon;
}

/**
 * Figure contract (see dataviz skill's marks-and-anatomy.md): label in
 * sentence case with no trailing colon, value in proportional figures (never
 * `tabular-nums` — that's reserved for columns that must align vertically).
 * `icon` is optional and purely decorative (a small muted badge, not a
 * status signal) — existing callers that don't pass one keep the exact
 * layout they had before.
 */
export function StatTile({ label, value, description, icon: Icon }: StatTileProps) {
  return (
    <Card>
      <CardContent className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon ? (
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3.5 text-muted-foreground" />
            </div>
          ) : null}
        </div>
        <p className="text-3xl font-semibold [font-variant-numeric:proportional-nums]">{value}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardContent>
    </Card>
  );
}
