import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface StatTileProps {
  label: string;
  value: string;
  description?: ReactNode;
}

/**
 * Figure contract (see dataviz skill's marks-and-anatomy.md): label in
 * sentence case with no trailing colon, value in proportional figures (never
 * `tabular-nums` — that's reserved for columns that must align vertically).
 */
export function StatTile({ label, value, description }: StatTileProps) {
  return (
    <Card>
      <CardContent className="space-y-1.5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold [font-variant-numeric:proportional-nums]">{value}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardContent>
    </Card>
  );
}
