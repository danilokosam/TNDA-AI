"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ExportColumnOption } from "@/features/documents/export-columns";
import { EXPORT_FORMATS, type ExportColumnSpec, type ExportFormat } from "@/types/api";

interface ColumnRow {
  field: string;
  label: string;
  included: boolean;
}

interface DocumentsExportConfigureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableColumns: ExportColumnOption[];
  onExport: (config: { format: ExportFormat; fieldSelection: ExportColumnSpec[] }) => void;
  isPending: boolean;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "XLSX (Excel)",
  json: "JSON",
  xml: "XML",
};

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;

  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

/**
 * Column selection, ordering, and renaming for a configured export — opened
 * from DocumentsExportButton's "Customize columns…" menu item. Leaving
 * every row checked, in its default order, with its default label
 * reproduces the same content as the plain (unconfigured) export; nothing
 * here ever touches the underlying document data (docs/adr/0015-configurable-export-formats.md).
 */
export function DocumentsExportConfigureDialog({
  open,
  onOpenChange,
  availableColumns,
  onExport,
  isPending,
}: DocumentsExportConfigureDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [columns, setColumns] = useState<ColumnRow[]>(() =>
    availableColumns.map((column) => ({ field: column.field, label: column.defaultLabel, included: true })),
  );

  const handleToggleIncluded = (field: string) => {
    setColumns((current) => current.map((row) => (row.field === field ? { ...row, included: !row.included } : row)));
  };

  const handleRelabel = (field: string, label: string) => {
    setColumns((current) => current.map((row) => (row.field === field ? { ...row, label } : row)));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    setColumns((current) => moveItem(current, index, direction));
  };

  const handleExport = () => {
    onExport({
      format,
      fieldSelection: columns.filter((row) => row.included).map((row) => ({ field: row.field, label: row.label })),
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Customize export</SheetTitle>
          <SheetDescription>Choose which columns to include, their order, and their output name.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-format">Format</Label>
            <select
              id="export-format"
              aria-label="Format"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              {EXPORT_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {FORMAT_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            {columns.map((row, index) => (
              <div key={row.field} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={row.label}
                  checked={row.included}
                  onChange={() => handleToggleIncluded(row.field)}
                />
                <Input
                  aria-label={`Output name for ${row.field}`}
                  value={row.label}
                  onChange={(event) => handleRelabel(row.field, event.target.value)}
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${row.field} up`}
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${row.field} down`}
                  disabled={index === columns.length - 1}
                  onClick={() => handleMove(index, 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <SheetFooter>
          <Button type="button" disabled={isPending} onClick={handleExport}>
            {isPending ? "Exporting…" : "Export"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
