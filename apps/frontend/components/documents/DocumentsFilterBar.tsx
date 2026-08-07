"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DOCUMENT_TYPE_LABELS } from "@/components/upload/DocumentTypeSelect";
import { DOCUMENT_TYPES, type DocumentJobStatus } from "@/types/api";
import type { DocumentsFilters } from "@/features/documents/filters";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: DocumentJobStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "rejected_quota", label: "Quota exceeded" },
];

const NATIVE_FIELD_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

interface DocumentsFilterBarProps {
  filters: DocumentsFilters;
  onFilterChange: (key: keyof DocumentsFilters, value: string | undefined) => void;
  onReset: () => void;
}

/**
 * Search is debounced (§ see `useDebouncedValue`) so typing doesn't fire a
 * request per keystroke; every other field commits immediately, matching
 * `DocumentTypeSelect`'s existing native-`<select>` precedent (no
 * `components/ui/select.tsx` exists, and a handful of fixed options don't
 * need it). Resetting all fields (including the search box's own local,
 * uncommitted text) is the parent's job via a remount `key`, not this
 * component's own state — see `DocumentsWorkspace`.
 */
export function DocumentsFilterBar({ filters, onFilterChange, onReset }: DocumentsFilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const debouncedSearch = useDebouncedValue(searchInput, 400);

  useEffect(() => {
    if (debouncedSearch !== (filters.search ?? "")) {
      onFilterChange("search", debouncedSearch);
    }
  }, [debouncedSearch, filters.search, onFilterChange]);

  const hasActiveFilters = Object.values(filters).some((value) => value !== undefined && value !== "");

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="documents-search" className="text-xs text-muted-foreground">
          Search
        </label>
        <Input
          id="documents-search"
          placeholder="File name…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="h-8 w-48"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="documents-status" className="text-xs text-muted-foreground">
          Status
        </label>
        <select
          id="documents-status"
          value={filters.status ?? ""}
          onChange={(event) => onFilterChange("status", event.target.value || undefined)}
          className={cn(NATIVE_FIELD_CLASS, "w-40")}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="documents-type" className="text-xs text-muted-foreground">
          Type
        </label>
        <select
          id="documents-type"
          value={filters.documentType ?? ""}
          onChange={(event) => onFilterChange("documentType", event.target.value || undefined)}
          className={cn(NATIVE_FIELD_CLASS, "w-40")}
        >
          <option value="">All types</option>
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {DOCUMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="documents-date-from" className="text-xs text-muted-foreground">
          From
        </label>
        <input
          id="documents-date-from"
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(event) => onFilterChange("dateFrom", event.target.value || undefined)}
          className={cn(NATIVE_FIELD_CLASS, "w-36")}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="documents-date-to" className="text-xs text-muted-foreground">
          To
        </label>
        <input
          id="documents-date-to"
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(event) => onFilterChange("dateTo", event.target.value || undefined)}
          className={cn(NATIVE_FIELD_CLASS, "w-36")}
        />
      </div>
      {hasActiveFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
