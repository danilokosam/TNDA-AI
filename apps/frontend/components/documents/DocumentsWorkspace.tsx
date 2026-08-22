"use client";

import { useReducer, useState } from "react";
import Link from "next/link";
import { FileClock } from "lucide-react";
import { DocumentsExportButton } from "@/components/documents/DocumentsExportButton";
import { DocumentsFilterBar } from "@/components/documents/DocumentsFilterBar";
import { DocumentsTable } from "@/components/documents/DocumentsTable";
import { DocumentsPagination } from "@/components/documents/DocumentsPagination";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useDocumentsList } from "@/features/documents/hooks";
import { deriveAvailableExportColumns } from "@/features/documents/export-columns";
import {
  currentCursor,
  documentsListReducer,
  initialDocumentsListState,
  type DocumentsFilters,
} from "@/features/documents/filters";

const PAGE_SIZE = 20;

interface DocumentsWorkspaceProps {
  canExport: boolean;
}

/**
 * `filterBarKey` forces a full remount of `DocumentsFilterBar` on reset —
 * simpler and safer than syncing its internal (debounced) search-input
 * state back down from a prop change, and standard React practice for
 * "clear a subtree's own local state from outside" (see the bar's own doc
 * comment).
 */
export function DocumentsWorkspace({ canExport }: DocumentsWorkspaceProps) {
  const [state, dispatch] = useReducer(documentsListReducer, initialDocumentsListState);
  const [filterBarKey, setFilterBarKey] = useState(0);

  const { data, isLoading, isError } = useDocumentsList({
    ...state.filters,
    cursor: currentCursor(state),
    limit: PAGE_SIZE,
  });

  const hasActiveFilters = Object.keys(state.filters).length > 0;

  function handleFilterChange(key: keyof DocumentsFilters, value: string | undefined) {
    dispatch({ type: "set-filter", key, value });
  }

  function handleReset() {
    dispatch({ type: "reset-filters" });
    setFilterBarKey((key) => key + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DocumentsFilterBar
          key={filterBarKey}
          filters={state.filters}
          onFilterChange={handleFilterChange}
          onReset={handleReset}
        />
        <DocumentsExportButton
          filters={state.filters}
          availableColumns={deriveAvailableExportColumns(data?.data ?? [])}
          canExport={canExport}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Loading…</p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Couldn&apos;t load documents. Please try again.</p>
      ) : data.data.length > 0 ? (
        <>
          <DocumentsTable jobs={data.data} />
          <DocumentsPagination
            canGoBack={state.cursors.length > 0}
            hasMore={data.pagination.hasMore}
            onPrev={() => dispatch({ type: "prev-page" })}
            onNext={() => {
              if (data.pagination.nextCursor) {
                dispatch({ type: "next-page", cursor: data.pagination.nextCursor });
              }
            }}
          />
        </>
      ) : hasActiveFilters ? (
        // No redundant action button here — the filter bar above already
        // shows its own "Clear filters" button whenever a filter is active,
        // which is always true in this branch; a second one with the same
        // label would just be duplicate UI (and an ambiguous a11y target).
        <EmptyState
          icon={FileClock}
          title="No documents match these filters"
          description="Try adjusting or clearing the filters above."
        />
      ) : (
        <EmptyState
          icon={FileClock}
          title="No documents yet"
          description="Upload your first document to see it here."
          action={
            <Button asChild>
              <Link href="/upload">Upload a document</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
