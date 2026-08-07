"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LineChart, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "@/components/ui/card";
import { formatShortDate } from "@/lib/format";
import type { OrganizationStats } from "@/types/api";

interface DocumentsTrendChartProps {
  dailyCounts: OrganizationStats["dailyCounts"];
  className?: string;
}

const VIEW_W = 720;
const VIEW_H = 240;
const MARGIN = { top: 16, right: 12, bottom: 28, left: 36 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;
const MAX_X_LABELS = 6;

/** Rounds a rough step up to a "clean" 1/2/5×10^n number (the standard nice-ticks step). */
function niceStep(roughStep: number): number {
  const safeStep = roughStep > 0 ? roughStep : 1;
  const magnitude = 10 ** Math.floor(Math.log10(safeStep));
  const normalized = safeStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

/** Clean, round y-axis ticks from 0 up to (at least) `maxValue` — never raw/jagged numbers. */
function computeYAxis(maxValue: number, targetTicks = 4): { ticks: number[]; max: number } {
  const step = niceStep(maxValue / targetTicks);
  const ticks: number[] = [];
  for (let value = 0; value <= maxValue + step * 0.001; value += step) {
    ticks.push(Math.round(value));
  }
  if (ticks.length < 2) ticks.push(step);
  return { ticks, max: ticks[ticks.length - 1] ?? step };
}

/**
 * Single-series line + soft-area trend chart with a table-view twin, per the
 * dataviz skill: crosshair + tooltip on hover, the same detail reachable on
 * keyboard focus, no legend (one series — the card title already names it),
 * and a direct label on the endpoint only (never a number on every point).
 */
export function DocumentsTrendChart({ dailyCounts, className }: DocumentsTrendChartProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = dailyCounts.length;

  if (n === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Documents processed</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No activity in this window.</p>
        </CardContent>
      </Card>
    );
  }

  const lastIndex = n - 1;
  // Safe: n > 0 was just established above, so index `n - 1` is in bounds —
  // `noUncheckedIndexedAccess` can't see that, so this guard makes it explicit.
  const lastPoint = dailyCounts[lastIndex];
  if (!lastPoint) return null;

  const maxCount = Math.max(0, ...dailyCounts.map((d) => d.count));
  const { ticks: yTicks, max: yMax } = computeYAxis(maxCount);

  const xAt = (index: number) => (n > 1 ? MARGIN.left + (index / (n - 1)) * PLOT_W : MARGIN.left + PLOT_W / 2);
  const yAt = (value: number) => MARGIN.top + PLOT_H - (yMax > 0 ? (value / yMax) * PLOT_H : 0);

  const linePath = dailyCounts.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yAt(d.count).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${xAt(lastIndex).toFixed(2)},${yAt(0).toFixed(2)} L${xAt(0).toFixed(2)},${yAt(0).toFixed(2)} Z`;

  const labelIndices =
    n <= MAX_X_LABELS
      ? dailyCounts.map((_, i) => i)
      : Array.from(new Set(Array.from({ length: MAX_X_LABELS }, (_, i) => Math.round((i * (n - 1)) / (MAX_X_LABELS - 1)))));

  function indexFromPointerX(clientX: number): number {
    const svg = svgRef.current;
    if (!svg) return lastIndex;
    const rect = svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / rect.width) * VIEW_W;
    const ratio = (localX - MARGIN.left) / PLOT_W;
    return Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)));
  }

  function handleKeyDown(event: KeyboardEvent<SVGRectElement>) {
    const current = activeIndex ?? lastIndex;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex(Math.max(0, current - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex(Math.min(lastIndex, current + 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(lastIndex);
    }
  }

  const displayIndex = activeIndex ?? lastIndex;
  // Safe: displayIndex is either `lastIndex` or a value clamped into
  // [0, lastIndex] by handleKeyDown/indexFromPointerX above.
  const displayPoint = dailyCounts[displayIndex];
  if (!displayPoint) return null;

  const lastLabelY = yAt(lastPoint.count) < MARGIN.top + 14 ? yAt(lastPoint.count) + 16 : yAt(lastPoint.count) - 10;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Documents processed</CardTitle>
        <CardDescription>Last {n} days</CardDescription>
        <CardAction>
          <Button type="button" variant="ghost" size="sm" onClick={() => setView(view === "chart" ? "table" : "chart")}>
            {view === "chart" ? (
              <>
                <TableIcon /> View as table
              </>
            ) : (
              <>
                <LineChart /> View as chart
              </>
            )}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {view === "table" ? (
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Documents processed per day</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-normal">Date</th>
                  <th className="px-3 py-2 text-right font-normal">Documents</th>
                </tr>
              </thead>
              <tbody>
                {dailyCounts.map((d) => (
                  <tr key={d.date} className="border-b last:border-0">
                    <td className="px-3 py-2">{formatShortDate(d.date)}</td>
                    <td className="px-3 py-2 text-right [font-variant-numeric:tabular-nums]">{d.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="relative">
            <svg ref={svgRef} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block w-full" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
              {yTicks.map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={VIEW_W - MARGIN.right} y1={yAt(tick)} y2={yAt(tick)} stroke="var(--color-border)" strokeWidth={1} />
                  <text x={MARGIN.left - 8} y={yAt(tick)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px] [font-variant-numeric:tabular-nums]">
                    {tick.toLocaleString()}
                  </text>
                </g>
              ))}

              {labelIndices.map((index) => {
                const point = dailyCounts[index];
                if (!point) return null;
                return (
                  <text key={index} x={xAt(index)} y={VIEW_H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {formatShortDate(point.date)}
                  </text>
                );
              })}

              <path d={areaPath} fill="var(--color-chart-1)" fillOpacity={0.1} stroke="none" />
              <path d={linePath} fill="none" stroke="var(--color-chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

              {activeIndex !== null && activeIndex !== lastIndex ? (
                <>
                  <line x1={xAt(activeIndex)} x2={xAt(activeIndex)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} stroke="var(--color-muted-foreground)" strokeWidth={1} />
                  <circle cx={xAt(activeIndex)} cy={yAt(displayPoint.count)} r={4} fill="var(--color-chart-1)" stroke="var(--color-card)" strokeWidth={2} />
                </>
              ) : null}

              {/* End-of-line marker + direct label — always visible, per marks-and-anatomy.md's "label selectively" rule. */}
              <circle cx={xAt(lastIndex)} cy={yAt(lastPoint.count)} r={4} fill="var(--color-chart-1)" stroke="var(--color-card)" strokeWidth={2} />
              <text x={xAt(lastIndex)} y={lastLabelY} textAnchor="end" className="fill-foreground text-[11px] font-medium [font-variant-numeric:tabular-nums]">
                {lastPoint.count.toLocaleString()}
              </text>

              <rect
                x={MARGIN.left}
                y={MARGIN.top}
                width={PLOT_W}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="slider"
                aria-orientation="horizontal"
                aria-label="Documents processed per day"
                aria-valuemin={0}
                aria-valuemax={lastIndex}
                aria-valuenow={displayIndex}
                aria-valuetext={`${formatShortDate(displayPoint.date)}: ${displayPoint.count.toLocaleString()} documents`}
                onPointerMove={(event: PointerEvent<SVGRectElement>) => setActiveIndex(indexFromPointerX(event.clientX))}
                onPointerLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex((current) => current ?? lastIndex)}
                onBlur={() => setActiveIndex(null)}
                onKeyDown={handleKeyDown}
                className="cursor-crosshair outline-none"
              />
            </svg>

            {activeIndex !== null ? (
              <div
                className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
                style={{ left: `${Math.min(90, Math.max(10, (xAt(activeIndex) / VIEW_W) * 100))}%` }}
              >
                <p className="text-sm font-semibold [font-variant-numeric:tabular-nums]">{displayPoint.count.toLocaleString()} documents</p>
                <p className="text-xs text-muted-foreground">{formatShortDate(displayPoint.date)}</p>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
